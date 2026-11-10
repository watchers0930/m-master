// lib/ads/disconnect.ts — 광고 계정 해제(설계서 §5.6-1 수명주기). 키를 지우는 유일한 경로.
// 순서(바꾸지 않는다):
//   ① 네이버의 모든 캠페인 중 켜진 것을 끈다 — buildPause('campaign') 최소 본문 + PUT ?fields=userLock (비상 정지 스위치와 무관: 끄기는 항상 허용)
//   ② 목록을 다시 읽어 모든 캠페인 userLock === true 를 확인한다(PUT 응답이 아니라 재조회가 판정)
//   ③ 그때만 키 blob·keyLast4를 null로, status='disabled'
//   ④ 미러·성과·공유예산/채널 기록은 보존(재연결 시 같은 행 재활성). 미러 캠페인은 userLock=true·lockedBy='owner'로 맞춘다
//      — 재연결 뒤 가드가 'guard' 잠금으로 오인해 자동 재개하지 않게.
// - 하나라도 확인하지 못하면 키를 지우지 않고 502 disconnect_incomplete(확인 못 한 개수)로 중단한다. 다시 시도하면 남은 것만 끈다.
// - 키가 무효(invalid_key)면 캠페인을 끌 수 없으므로 해제하지 않는다(409) — 새 키로 교체한 뒤 해제.
// - 이미 disabled면 멱등(네이버 호출 없음).
// - 목록이 recordSize 상한(1000)만큼 차면 잘렸을 수 있으므로 확인 실패로 본다(⚠️ 네이버 기본 페이지 크기는 Task 13 실측).
import { NaverAdsError } from "@/lib/external/naver-searchad";
import { prisma } from "@/lib/prisma";
import { naverCampaignListSchema } from "@/schemas/ads";
import type { AdAccountDTO } from "@/types/ads";
import { assertAdsOwner } from "./access";
import { CAMPAIGN_PAGE, accountDTO, listCampaigns, loadOwnedAccount, withAccountClient, type AdsDeps } from "./account-core";
import { AdsHttpError } from "./http";
import { sendMutation } from "./oplog";
import { buildPause } from "./requests";

const pauseResponseSchema = naverCampaignListSchema.element;

export async function disconnectAccount(ownerId: string, accountId: string, deps: AdsDeps = {}): Promise<AdAccountDTO> {
  assertAdsOwner(ownerId);
  const row = await loadOwnedAccount(ownerId, accountId);
  if (row.status === "disabled") return accountDTO(ownerId, row.id);
  if (row.status !== "active")
    throw new AdsHttpError("ads_key_invalid", "키가 무효라 캠페인을 끌 수 없어 해제를 중단했습니다. 새 키로 교체한 뒤 해제하세요(키는 그대로 유지됩니다).", 409);

  const unconfirmed = await withAccountClient(row, deps, async (client) => {
    const campaigns = await listCampaigns(client);
    for (const c of campaigns) {
      if (c.userLock === true) continue;
      try {
        await sendMutation(client, row, {
          step: "campaign.pause", method: "PUT", path: `/ncc/campaigns/${c.nccCampaignId}`, query: { fields: "userLock" },
          body: buildPause("campaign", c.nccCampaignId), naverId: c.nccCampaignId,
        }, pauseResponseSchema);
      } catch (error) {
        // 키 무효는 즉시 중단(withAccountClient가 invalid_key로 표시). 그 외 실패·불확실은 재조회가 판정한다.
        if (error instanceof NaverAdsError && error.reason === "ads_auth_failed") throw error;
      }
    }
    const after = await listCampaigns(client);
    if (after.length >= CAMPAIGN_PAGE) return after.length;
    return after.filter((c) => c.userLock !== true).length;
  });
  if (unconfirmed > 0)
    throw new AdsHttpError(
      "disconnect_incomplete", "일부 캠페인이 꺼진 것을 확인하지 못해 해제를 중단했습니다. 키는 그대로 유지됩니다. 잠시 후 다시 시도하세요.", 502,
      { unconfirmedCampaigns: unconfirmed },
    );

  await prisma.$transaction([
    prisma.adCampaign.updateMany({ where: { adAccountId: row.id, ownerId: row.ownerId }, data: { userLock: true, lockedBy: "owner" } }),
    prisma.adAccount.updateMany({
      where: { id: row.id, ownerId, status: { not: "disabled" } },
      data: { apiKeyEnc: null, secretKeyEnc: null, keyLast4: null, status: "disabled" },
    }),
  ]);
  return accountDTO(ownerId, row.id);
}
