// lib/ads/disconnect.ts — 광고 계정 해제(설계서 §5.6-1 수명주기). 키를 지우는 유일한 경로.
// 순서(바꾸지 않는다, 적대 검토 Task 5 I-1·I-2 반영):
//   ⓪ 조건부 전이 status(active|invalid_key) → 'disconnecting'(같은 트랜잭션에서 미러 캠페인 lockedBy='owner', 미러 4개 lockVersion +1).
//      이후 clientForAccount(다른 모든 작업자: 가드 자동 재개·켜기·동기화)는 네트워크 전에 거부된다. 동시 해제 2건 중 하나만 진행(409).
//      해제 자신은 clientForDisconnect(status='disconnecting' 전용)를 쓴다.
//   ① 모든 캠페인 페이지를 읽어(listAllCampaigns) 꺼지지 않은 것만 buildPause + PUT ?fields=userLock (끄기는 비상 정지 스위치와 무관)
//   ② 최종 전체 재조회: 모든 캠페인이 꺼짐(userLock=true 또는 DELETED)이고, 목록이 완전하며(빈 페이지까지 읽음),
//      이 계정의 모든 미러 naverId가 읽은 집합에 있어야 한다. PUT 응답이 아니라 이 재조회가 판정한다.
//   ③ 그때만(상태가 여전히 'disconnecting'일 때) 키 blob·keyLast4 null + status='disabled', 미러 userLock=true.
//   ④ 미러·성과·공유예산/채널 기록은 보존(재연결 시 같은 행 재활성).
// - 중단(확인 실패·네이버 오류·복호화 오류)하면 'disconnecting' → 이전 상태로 되돌려 가드가 계속 감시하게 한다. 키는 그대로.
//   중단 원인이 키 무효(ads_auth_failed)면 복원 후 invalid_key + 알림(markInvalidKey).
// - 멈춘 해제(프로세스 사망으로 'disconnecting'에 남음) 회수: updatedAt이 STALE_CLAIM_MS(10분)보다 오래된 행만 다시 해제가 재점유한다
//   (조건부 updateMany status='disconnecting' AND updatedAt < now-10분, count 1 — 동시 재점유는 하나만). 재점유는 updatedAt을 갱신한다.
//   10분 근거: 해제 라우트 maxDuration 300초, 네이버 작업은 DISCONNECT_WORK_MS(270초) 창 안에서만 시작·종료한다 — 정상 실행은 5분 안에 끝나므로
//   10분 넘게 갱신 없는 disconnecting은 죽은 실행이다. 젊은 행은 409(진행 중).
// - 해제 전 상태는 첫 점유 때 disconnectFromStatus에 저장한다 → 재점유 뒤 중단해도 원래 상태(active|invalid_key)로 복원.
// - 한계: ② 이후 ③ 사이에, ⓪ 이전에 이미 만들어 둔 클라이언트로 켜는 작업자는 여기서 막을 수 없다 → Task 9/11의 모든 켜기·쓰기는
//   보내기 직전 status==='active'를 다시 확인해야 한다(CARRY).
import { NaverAdsError, clientForDisconnect, type NaverAdsClient } from "@/lib/external/naver-searchad";
import { prisma } from "@/lib/prisma";
import { naverCampaignListSchema } from "@/schemas/ads";
import type { AdAccount } from "@prisma/client";
import type { AdAccountDTO } from "@/types/ads";
import { assertAdsOwner } from "./access";
import { STALE_CLAIM_MS, accountDTO, isCampaignOff, listAllCampaigns, loadOwnedAccount, markInvalidKey, type AdsDeps } from "./account-core";
import { AdsHttpError } from "./http";
import { sendMutation } from "./oplog";
import { buildPause } from "./requests";

const pauseResponseSchema = naverCampaignListSchema.element;
const CLAIMABLE = ["active", "invalid_key"] as const;
export { STALE_CLAIM_MS } from "./account-core";
/** 해제 라우트 maxDuration 300초 − 여유 30초(최종 판정 A2): 남은 시간이 30초 미만이면 네이버 호출을 새로 시작하지 않고
 *  키를 유지한 채 중단(상태 복원 → 감시가 계속 본다). 각 호출 마감 = min(45초, 남은 창) — 창을 넘겨 끝나는 호출이 없다. */
export const DISCONNECT_WORK_MS = 270_000;
const deadlineAbort = (unconfirmed: number) => new AdsHttpError(
  "disconnect_incomplete", "시간 안에 모든 캠페인을 끄고 확인하지 못해 해제를 중단했습니다. 키는 그대로 유지됩니다. 다시 시도하세요.", 502,
  { unconfirmedCampaigns: unconfirmed, reason: "deadline" },
);
const inProgress = () => new AdsHttpError("disconnect_in_progress", "이미 해제가 진행 중이거나 계정 상태가 바뀌었습니다. 잠시 후 다시 확인하세요.", 409);

/** ①② — 확인하지 못한 캠페인 수(0이면 전부 꺼짐 확인). 목록 일괄 재조회로 판정한다 — 단건 pauseAndConfirm(execution.ts)과 다른 의도된 예외.
 *  left() ≤ 0(창 소진)이면 다음 호출을 시작하지 않고 deadlineAbort(키 유지). */
async function pauseAllAndConfirm(client: NaverAdsClient, row: AdAccount, left: () => number): Promise<number> {
  const first = await listAllCampaigns(client);
  const lit = first.campaigns.filter((c) => !isCampaignOff(c));
  for (const [i, c] of lit.entries()) {
    if (left() <= 0) throw deadlineAbort(lit.length - i);
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
  if (left() <= 0) throw deadlineAbort(Math.max(lit.length, 1));
  const final = await listAllCampaigns(client);
  const ids = new Set(final.campaigns.map((c) => c.nccCampaignId));
  const mirror = await prisma.adCampaign.findMany({ where: { adAccountId: row.id, ownerId: row.ownerId }, select: { naverId: true } });
  const unconfirmed = final.campaigns.filter((c) => !isCampaignOff(c)).length + mirror.filter((m) => !ids.has(m.naverId)).length;
  return final.complete ? unconfirmed : Math.max(unconfirmed, 1);
}

async function revert(row: AdAccount, previous: string, error?: unknown): Promise<void> {
  await prisma.adAccount.updateMany({
    where: { id: row.id, ownerId: row.ownerId, status: "disconnecting" }, data: { status: previous, disconnectFromStatus: null },
  });
  if (error instanceof NaverAdsError && error.reason === "ads_auth_failed") await markInvalidKey(row.id);
}

export async function disconnectAccount(ownerId: string, accountId: string, deps: AdsDeps = {}): Promise<AdAccountDTO> {
  assertAdsOwner(ownerId);
  const row = await loadOwnedAccount(ownerId, accountId);
  if (row.status === "disabled") return accountDTO(ownerId, row.id);
  const now = (deps.now ?? (() => new Date()))();
  const takeover = row.status === "disconnecting";
  if (!takeover && !(CLAIMABLE as readonly string[]).includes(row.status)) throw inProgress();
  // 재점유면 첫 점유 때 저장한 원래 상태로 복원한다(값이 없거나 이상하면 active — 다음 호출이 키 무효를 다시 판정)
  const stored = row.disconnectFromStatus ?? "";
  const previous = takeover ? ((CLAIMABLE as readonly string[]).includes(stored) ? stored : "active") : row.status;

  // ⓪ 조건부 전이(첫 점유: 이전 상태 → disconnecting / 재점유: 10분 넘게 멈춘 disconnecting만) + 미러 owner 잠금(같은 트랜잭션).
  //    읽은 뒤 상태가 바뀌었거나 다른 실행이 먼저 점유했으면 count 0 → 409.
  await prisma.$transaction(async (tx) => {
    const where = takeover
      ? { id: row.id, ownerId, status: "disconnecting", updatedAt: { lt: new Date(now.getTime() - STALE_CLAIM_MS) } }
      : { id: row.id, ownerId, status: row.status };
    const { count } = await tx.adAccount.updateMany({ where, data: { status: "disconnecting", disconnectFromStatus: previous, updatedAt: now } });
    if (count !== 1) throw inProgress();
    // 잠금 변경이므로 lockVersion +1(미러 4개 전부) — 이 시점에 진행 중인 켜기의 결과 기록 CAS가 0행이 되어 다시 끈다(Task 9 adv I-3)
    const scope = { where: { adAccountId: row.id, ownerId: row.ownerId } };
    await tx.adCampaign.updateMany({ ...scope, data: { lockedBy: "owner", lockVersion: { increment: 1 } } });
    await tx.adGroup.updateMany({ ...scope, data: { lockVersion: { increment: 1 } } });
    await tx.adKeyword.updateMany({ ...scope, data: { lockVersion: { increment: 1 } } });
    await tx.adCreative.updateMany({ ...scope, data: { lockVersion: { increment: 1 } } });
  });

  let unconfirmed: number;
  const clock = deps.naverClock?.now ?? Date.now;
  const end = clock() + DISCONNECT_WORK_MS;
  const left = deps.callBudget ?? (() => end - clock());
  try {
    const client = clientForDisconnect({ ...row, status: "disconnecting" }, deps.transport, { clock: deps.naverClock, budget: left });
    unconfirmed = await pauseAllAndConfirm(client, row, left);
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
      data: { apiKeyEnc: null, secretKeyEnc: null, keyLast4: null, status: "disabled", disconnectFromStatus: null },
    });
    if (count !== 1) throw inProgress();
    await tx.adCampaign.updateMany({ where: { adAccountId: row.id, ownerId: row.ownerId }, data: { userLock: true, lockedBy: "owner", lockVersion: { increment: 1 } } });
  });
  return accountDTO(ownerId, row.id);
}
