// lib/ads/disconnect.ts — 광고 계정 해제(설계서 §5.6-1 수명주기). 키를 지우는 유일한 경로.
// 순서(바꾸지 않는다, 적대 검토 Task 5 I-1·I-2 반영):
//   ⓪ 조건부 전이 status(active|invalid_key) → 'disconnecting'(같은 트랜잭션에서 미러 캠페인 lockedBy='owner').
//      이후 clientForAccount(다른 모든 작업자: 가드 자동 재개·켜기·동기화)는 네트워크 전에 거부된다. 동시 해제 2건 중 하나만 진행(409).
//      해제 자신은 clientForDisconnect(status='disconnecting' 전용)를 쓴다.
//   ① 모든 캠페인 페이지를 읽어(listAllCampaigns) 꺼지지 않은 것만 buildPause + PUT ?fields=userLock (끄기는 비상 정지 스위치와 무관)
//   ② 최종 전체 재조회: 모든 캠페인이 꺼짐(userLock=true 또는 DELETED)이고, 목록이 완전하며(빈 페이지까지 읽음),
//      이 계정의 모든 미러 naverId가 읽은 집합에 있어야 한다. PUT 응답이 아니라 이 재조회가 판정한다.
//   ③ 그때만(상태가 여전히 'disconnecting'일 때) 키 blob·keyLast4 null + status='disabled', 미러 userLock=true.
//   ④ 미러·성과·공유예산/채널 기록은 보존(재연결 시 같은 행 재활성).
// - 중단(확인 실패·네이버 오류·복호화 오류)하면 'disconnecting' → 이전 상태로 되돌려 가드가 계속 감시하게 한다. 키는 그대로.
//   중단 원인이 키 무효(ads_auth_failed)면 복원 후 invalid_key + 알림(markInvalidKey).
// - 한계: ② 이후 ③ 사이에, ⓪ 이전에 이미 만들어 둔 클라이언트로 켜는 작업자는 여기서 막을 수 없다 → Task 9/11의 모든 켜기·쓰기는
//   보내기 직전 status==='active'를 다시 확인해야 한다(CARRY).
import { NaverAdsError, clientForDisconnect, type NaverAdsClient } from "@/lib/external/naver-searchad";
import { prisma } from "@/lib/prisma";
import { naverCampaignListSchema } from "@/schemas/ads";
import type { AdAccount } from "@prisma/client";
import type { AdAccountDTO } from "@/types/ads";
import { assertAdsOwner } from "./access";
import { accountDTO, isCampaignOff, listAllCampaigns, loadOwnedAccount, markInvalidKey, type AdsDeps } from "./account-core";
import { AdsHttpError } from "./http";
import { sendMutation } from "./oplog";
import { buildPause } from "./requests";

const pauseResponseSchema = naverCampaignListSchema.element;
const CLAIMABLE = ["active", "invalid_key"] as const;
const inProgress = () => new AdsHttpError("disconnect_in_progress", "이미 해제가 진행 중이거나 계정 상태가 바뀌었습니다. 잠시 후 다시 확인하세요.", 409);

/** ①② — 확인하지 못한 캠페인 수(0이면 전부 꺼짐 확인). */
async function pauseAndConfirm(client: NaverAdsClient, row: AdAccount): Promise<number> {
  const first = await listAllCampaigns(client);
  for (const c of first.campaigns) {
    if (isCampaignOff(c)) continue;
    try {
      await sendMutation(client, row, {
        step: "campaign.pause", method: "PUT", path: `/ncc/campaigns/${c.nccCampaignId}`, query: { fields: "userLock" },
        body: buildPause("campaign", c.nccCampaignId), naverId: c.nccCampaignId,
      }, pauseResponseSchema);
    } catch (error) {
      // 키 무효는 즉시 중단. 그 외 실패·불확실은 최종 재조회가 판정한다.
      if (error instanceof NaverAdsError && error.reason === "ads_auth_failed") throw error;
    }
  }
  const final = await listAllCampaigns(client);
  const ids = new Set(final.campaigns.map((c) => c.nccCampaignId));
  const mirror = await prisma.adCampaign.findMany({ where: { adAccountId: row.id, ownerId: row.ownerId }, select: { naverId: true } });
  const unconfirmed = final.campaigns.filter((c) => !isCampaignOff(c)).length + mirror.filter((m) => !ids.has(m.naverId)).length;
  return final.complete ? unconfirmed : Math.max(unconfirmed, 1);
}

async function revert(row: AdAccount, previous: string, error?: unknown): Promise<void> {
  await prisma.adAccount.updateMany({ where: { id: row.id, ownerId: row.ownerId, status: "disconnecting" }, data: { status: previous } });
  if (error instanceof NaverAdsError && error.reason === "ads_auth_failed") await markInvalidKey(row.id);
}

export async function disconnectAccount(ownerId: string, accountId: string, deps: AdsDeps = {}): Promise<AdAccountDTO> {
  assertAdsOwner(ownerId);
  const row = await loadOwnedAccount(ownerId, accountId);
  if (row.status === "disabled") return accountDTO(ownerId, row.id);
  const previous = row.status;
  if (!(CLAIMABLE as readonly string[]).includes(previous)) throw inProgress();

  // ⓪ 조건부 전이 + 미러 owner 잠금(같은 트랜잭션). 읽은 뒤 상태가 바뀌었으면 count 0 → 409.
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.adAccount.updateMany({ where: { id: row.id, ownerId, status: previous }, data: { status: "disconnecting" } });
    if (count !== 1) throw inProgress();
    await tx.adCampaign.updateMany({ where: { adAccountId: row.id, ownerId: row.ownerId }, data: { lockedBy: "owner" } });
  });

  let unconfirmed: number;
  try {
    unconfirmed = await pauseAndConfirm(clientForDisconnect({ ...row, status: "disconnecting" }, deps.transport), row);
  } catch (error) {
    await revert(row, previous, error);
    throw error;
  }
  if (unconfirmed > 0) {
    await revert(row, previous);
    throw new AdsHttpError(
      "disconnect_incomplete", "일부 캠페인이 꺼진 것을 확인하지 못해 해제를 중단했습니다. 키는 그대로 유지됩니다. 잠시 후 다시 시도하세요.", 502,
      { unconfirmedCampaigns: unconfirmed },
    );
  }

  // ③ 여전히 disconnecting일 때만(그 사이 재연결 등으로 상태가 바뀌었으면 지우지 않는다)
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.adAccount.updateMany({
      where: { id: row.id, ownerId, status: "disconnecting" },
      data: { apiKeyEnc: null, secretKeyEnc: null, keyLast4: null, status: "disabled" },
    });
    if (count !== 1) throw inProgress();
    await tx.adCampaign.updateMany({ where: { adAccountId: row.id, ownerId: row.ownerId }, data: { userLock: true, lockedBy: "owner" } });
  });
  return accountDTO(ownerId, row.id);
}
