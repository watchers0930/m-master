// lib/ads/lock-pause.ts — 대장 끄기(Task 9 판정 I-1: 끄기는 정책 게이트로 막지 않는다).
// - 스위치·상한·검수·제안 상태·expected_lock_version과 무관하게 보낸다. 늘 이긴다(버전이 달라도 409 없음).
// - 의도를 네트워크 전에 미러에 먼저 기록한다: lockedBy='owner', lockVersion+1, lockedAt=now. 단 guard 잠금은 guard로 남긴다
//   (끄기로 가드 잠금을 owner로 세탁해 당일 켜기 제한을 우회하지 못하게) — lockVersion만 +1.
// - 끄기 전용 클라이언트(clientForPause): 계정 status active | invalid_key | disconnecting을 받고 끄기 본문만 보낼 수 있다.
//   disabled(키 삭제됨)는 보낼 수 없으므로 409 keys_removed(네이버 화면에서 직접 끄라는 안내).
// - PUT이 실패해도 의도 기록은 남고 오류를 돌려준다. 결과(userLock)는 lockVersion이 그대로일 때만 기록한다.
import type { AdAccount } from "@prisma/client";
import { NaverAdsError, clientForPause } from "@/lib/external/naver-searchad";
import { prisma } from "@/lib/prisma";
import { markInvalidKey } from "./account-core";
import { putUserLock } from "./execution";
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
    // 두 조건부 갱신이 서로 배타적이다(잠금 아래에서 lockedBy를 다시 본다): guard 아님 → owner, guard → 버전만
    await m.updateMany({ where: { id, ownerId, OR: [{ lockedBy: null }, { lockedBy: { not: "guard" } }] }, data: { lockedBy: "owner", lockedAt: now, lockVersion: { increment: 1 } } });
    await m.updateMany({ where: { id, ownerId, lockedBy: "guard" }, data: { lockVersion: { increment: 1 } } });
    return (await m.findFirst({ where: { id, ownerId }, select: MIRROR_SELECT })) as MirrorLockRow;
  });
}

/** 끄기 PUT(끄기 전용 클라이언트). 키 무효(401)면 계정을 invalid_key로 표시하고 다시 던진다. */
export async function pauseNow(account: AdAccount, type: LockKind, naverId: string, step: string, deps: LockDeps) {
  if (account.apiKeyEnc == null || account.secretKeyEnc == null) throw keysRemoved();
  const client = clientForPause(account, deps.transport);
  try {
    return await putUserLock(client, account, type, naverId, true, { step });
  } catch (error) {
    if (error instanceof NaverAdsError && error.reason === "ads_auth_failed") await markInvalidKey(account.id);
    throw error;
  }
}

export async function ownerPause(type: LockKind, ownerId: string, id: string, account: AdAccount, now: Date, deps: LockDeps): Promise<LockResult> {
  if (account.status === "disabled" || account.apiKeyEnc == null || account.secretKeyEnc == null) throw keysRemoved();
  const claimed = await recordIntent(type, ownerId, id, now, deps);
  const stored = await pauseNow(account, type, claimed.naverId, `owner.pause:${type}`, deps);
  const mirror = mirrorOf(prisma, type);
  await mirror.updateMany({ where: { id, lockVersion: claimed.lockVersion }, data: { userLock: stored.userLock } });
  return lockDto(type, (await mirror.findFirst({ where: { id, ownerId }, select: MIRROR_SELECT })) as MirrorLockRow);
}
