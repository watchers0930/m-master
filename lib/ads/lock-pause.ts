// lib/ads/lock-pause.ts — 대장 끄기(Task 9 판정 I-1: 끄기는 정책 게이트로 막지 않는다).
// - 스위치·상한·검수·제안 상태·expected_lock_version과 무관하게 보낸다. 늘 이긴다(버전이 달라도 409 없음).
// - 의도를 네트워크 전에 미러에 먼저 기록한다: lockedBy='owner', lockVersion+1, lockedAt=now. guard 잠금도 owner로 덮는다(판정 Task 11 I-2 —
//   대장이 끈 것을 다음 날 자동 재개가 켜면 안 된다). 같은 날 대장 켜기는 상한 검사(cap_reached)가 여전히 막는다.
// - 끄기 전용 클라이언트(clientForPause): 계정 status active | invalid_key | disconnecting을 받고 끄기 본문만 보낼 수 있다.
//   disabled(키 삭제됨)는 보낼 수 없으므로 409 keys_removed(네이버 화면에서 직접 끄라는 안내).
// - PUT이 실패해도 의도 기록은 남고 오류를 돌려준다. 결과(userLock)는 lockVersion이 그대로일 때만 기록한다. 실패면 userLock=false(켜짐·모름).
// - safetyPause: 시스템이 스스로 거는 안전 끄기(켜기 경합 재끄기·켜기 불확실 끄기·lock_race 재끄기, Task 11 가드가 재사용).
//   결과와 무관하게 미러에 사실(끄기 성공=true, 실패=false)을 기록하고, 실패하면 알림 ads.pause_failed(paused:false)를 보낸다(판정 round 2).
import type { AdAccount } from "@prisma/client";
import { NaverAdsError, clientForPause } from "@/lib/external/naver-searchad";
import { prisma } from "@/lib/prisma";
import { markInvalidKey } from "./account-core";
import { queueAlert, type AlertPayload } from "./alerts";
import { pauseAndConfirm } from "./execution";
import { AdsHttpError } from "./http";
import type { LockKind } from "./invariants";
import { MIRROR_SELECT, lockDto, lockMirrorRow, mirrorOf, type LockDeps, type LockResult, type MirrorLockRow } from "./lock-mirror";

export const keysRemoved = () =>
  new AdsHttpError("keys_removed", "연결 해제로 광고 키가 삭제된 계정입니다. MINTEQ에서 끌 수 없으니 네이버 광고 화면에서 직접 꺼 주세요.", 409);

async function recordIntent(type: LockKind, ownerId: string, id: string, now: Date, deps: LockDeps): Promise<MirrorLockRow> {
  return prisma.$transaction(async (tx) => {
    const row = await lockMirrorRow(tx, type, id, ownerId);
    await deps.afterLock?.(tx, row);
    const m = mirrorOf(tx, type);
    // 대장 끄기는 언제나 owner(판정 Task 11 I-2: guard도 덮는다 — 대장이 끈 것을 다음 날 자동 재개가 켜지 않게)
    await m.updateMany({ where: { id, ownerId }, data: { lockedBy: "owner", lockedAt: now, lockVersion: { increment: 1 } } });
    return (await m.findFirst({ where: { id, ownerId }, select: MIRROR_SELECT })) as MirrorLockRow;
  });
}

/** 끄기 PUT + 재조회 확인(끄기 전용 클라이언트, pauseAndConfirm). 키 무효(401)면 계정을 invalid_key로 표시하고 다시 던진다. */
export async function pauseNow(account: AdAccount, type: LockKind, naverId: string, step: string, deps: LockDeps) {
  if (account.apiKeyEnc == null || account.secretKeyEnc == null) throw keysRemoved();
  const client = clientForPause(account, deps.transport);
  try {
    return await pauseAndConfirm(client, account, type, naverId, { step });
  } catch (error) {
    if (error instanceof NaverAdsError && error.reason === "ads_auth_failed") await markInvalidKey(account.id, deps.now);
    throw error;
  }
}

/** 안전 끄기 실패·경합 알림(같은 날 ads.drift에 묻히지 않는 별도 유형). 알림 큐 실패는 원래 흐름을 가리지 않는다. */
export async function pauseAlert(account: AdAccount, payload: AlertPayload, now?: () => Date): Promise<void> {
  try {
    await queueAlert(account.id, "ads.pause_failed", payload, { ...(now ? { now } : {}), dedupeKey: String(payload.naverId ?? "") }); // KST 날짜: 주입 시계(감시) 또는 실제 시각, 엔티티별(판정 I-3)
  } catch (error) {
    console.error("[ads] pause_failed alert queue failed", { type: error instanceof Error ? error.name : "unknown" });
  }
}

/**
 * 안전 끄기. 끈 것이 확인되면 true. 어떤 실패도 던지지 않고 false — 미러 userLock=false(사실: 켜짐·모름) + 알림 ads.pause_failed.
 * 네이버 오류뿐 아니라 복호화·DB·예상 못 한 오류도 같다(Task 11 CARRY: 감시는 조용히 실패하지 않는다 — 원인 이름만 기록).
 * 알림 KST 날짜는 deps.now(감시는 주입 시각을 넘긴다), 없으면 실제 시각.
 * row.id = null: 미러 행이 없는 캠페인(네이버 화면에서 직접 만든 것 등). 미러 갱신 없이 끄기·알림만.
 */
export async function safetyPause(
  account: AdAccount, type: LockKind, row: { id: string | null; naverId: string }, step: string, deps: LockDeps, alert: AlertPayload,
): Promise<boolean> {
  let paused = false;
  try {
    paused = (await pauseNow(account, type, row.naverId, step, deps)).confirmed;
  } catch (error) {
    if (!(error instanceof NaverAdsError) && !(error instanceof AdsHttpError))
      console.error("[ads] safety pause failed", { step, type: error instanceof Error ? error.name : "unknown" });
  }
  if (row.id !== null) {
    try {
      await mirrorOf(prisma, type).updateMany({ where: { id: row.id }, data: { userLock: paused } });
    } catch (error) {
      console.error("[ads] safety pause mirror write failed", { step, type: error instanceof Error ? error.name : "unknown" });
    }
  }
  if (!paused) await pauseAlert(account, { ...alert, entity: type, naverId: row.naverId, paused: false }, deps.now);
  return paused;
}

export async function ownerPause(type: LockKind, ownerId: string, id: string, account: AdAccount, now: Date, deps: LockDeps): Promise<LockResult> {
  if (account.status === "disabled" || account.apiKeyEnc == null || account.secretKeyEnc == null) throw keysRemoved();
  const claimed = await recordIntent(type, ownerId, id, now, deps);
  const mirror = mirrorOf(prisma, type);
  let confirmed: boolean;
  try {
    confirmed = (await pauseNow(account, type, claimed.naverId, `owner.pause:${type}`, deps)).confirmed;
  } catch (error) {
    await mirror.updateMany({ where: { id, lockVersion: claimed.lockVersion }, data: { userLock: false } }); // 끄기 실패 = 켜짐·모름
    throw error;
  }
  await mirror.updateMany({ where: { id, lockVersion: claimed.lockVersion }, data: { userLock: confirmed } });
  if (!confirmed) {
    await pauseAlert(account, { reason: "owner_pause_unconfirmed", entity: type, naverId: claimed.naverId, paused: false });
    throw new AdsHttpError("pause_unconfirmed", "네이버가 끄기 요청을 받았지만 다시 확인했을 때 아직 켜져 있습니다. 네이버 광고 화면에서 지금 바로 직접 꺼 주세요.", 502);
  }
  return lockDto(type, (await mirror.findFirst({ where: { id, ownerId }, select: MIRROR_SELECT })) as MirrorLockRow);
}
