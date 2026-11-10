// lib/ads/locks.ts — 대장의 켜기·끄기(설계서 §5.5-7, §5.6-1 경합). 대상은 이 소유자의 미러 행(캠페인·그룹·키워드·소재).
// 끄기(locked=true): lock-pause.ts — 정책 게이트 없음, 늘 이긴다, 의도를 먼저 기록, 끄기 전용 클라이언트.
// 켜기(locked=false) 전제(하나라도 아니면 보내지 않는다):
//   스위치 on(503 ads_paused) · 계정 active · expected_lock_version 일치 · 미러의 제안이 applied(409 not_launchable) ·
//   lockedBy가 owner|pending_launch, 또는 guard인데 lockedAt의 KST 날짜가 오늘보다 이를 때(자동 재개 누락 — 사용자 결정: 가드 잠금은
//   다음 날 0시 KST 자동 재개). 같은 날·미래·null은 409 guard_locked ·
//   네이버에서 새로 읽은 엔티티와 그 상위(그룹·캠페인) 대조(불일치면 409 drift + 알림) · 키워드·소재 검수 APPROVED|ELIGIBLE(409 not_inspected) ·
//   오늘 비용 < dailyCapKrw(409 cap_reached, 모르면 409 spend_unknown).
// 경합: CAS는 (lockedBy, lockVersion)이다(updatedAt은 동기화 쓰기마다 바뀐다). 잠금 변경마다 lockVersion +1(해제 disconnect 포함),
//   동기화는 lockVersion을 건드리지 않는다.
//   ① 트랜잭션: FOR UPDATE → 재조회 → lockVersion·lockedBy 조건부 updateMany(count=1)로 '의도'를 먼저 기록 ② 네이버 PUT
//   ③ PUT 뒤 계정 상태 재확인: active가 아니면(해제가 그 사이 끝남) 끄기 전용 클라이언트로 즉시 끄고 알림 ads.drift(resume_race) + 409.
//   ④ 결과 기록은 lockVersion이 ①의 값 그대로일 때만. 그 사이 가드가 잠갔으면(count 0) 즉시 다시 끄고 409 lock_race.
//   켜기 PUT이 실패하면 ①의 기록을 되돌린다(불확실이면 안전 방향으로 끄기도 보낸다).
import type { AdAccount } from "@prisma/client";
import { NaverAdsError } from "@/lib/external/naver-searchad";
import { prisma } from "@/lib/prisma";
import { ADS_LOCK_ENTITY_TYPES } from "@/schemas/ads";
import { isEntityId } from "@/schemas/id";
import { assertAdsOwner } from "./access";
import { loadOwnedAccount, notFound, withAccountClient } from "./account-core";
import { queueAlert } from "./alerts";
import { assertExecutionEnabled, putUserLock } from "./execution";
import { AdsHttpError } from "./http";
import { caps, type LockKind } from "./invariants";
import { freshCheck } from "./launch-check";
import {
  MIRROR_SELECT, guardLockedToday, lockDto, lockMirrorRow, mirrorOf, type LockDeps, type LockEntity, type LockResult, type MirrorLockRow,
} from "./lock-mirror";
import { ownerPause, pauseNow } from "./lock-pause";
import { todayCostKrw } from "./spend";

export { mirrorOf, type LockDeps, type LockEntity, type LockResult, type MirrorDelegate, type MirrorLockRow } from "./lock-mirror";

const fail = (code: string, message: string, details?: Record<string, string | number | null>) => new AdsHttpError(code, message, 409, details);
const versionConflict = (current: number) =>
  fail("version_conflict", "다른 곳에서 켜기·끄기 상태가 바뀌었습니다. 최신 상태를 확인하세요.", { lock_version: current });
const guardLocked = () => fail("guard_locked", "오늘 하루 상한으로 감시가 멈춘 항목입니다. 내일 0시(KST)에 자동으로 다시 켜집니다.");

async function claimResume(type: LockKind, ownerId: string, id: string, expected: number, now: Date, deps: LockDeps): Promise<MirrorLockRow> {
  return prisma.$transaction(async (tx) => {
    const row = await lockMirrorRow(tx, type, id, ownerId);
    await deps.afterLock?.(tx, row);
    if (row.lockVersion !== expected) throw versionConflict(row.lockVersion);
    if (guardLockedToday(row, now)) throw guardLocked();
    const { count } = await mirrorOf(tx, type).updateMany({
      where: { id, ownerId, lockedBy: row.lockedBy, lockVersion: expected }, data: { lockedBy: null, lockedAt: now, lockVersion: { increment: 1 } },
    });
    if (count !== 1) throw versionConflict(row.lockVersion);
    return row;
  });
}

async function launchable(row: MirrorLockRow, now: Date): Promise<void> {
  if (guardLockedToday(row, now)) throw guardLocked();
  if (row.lockedBy !== null && !["owner", "pending_launch", "guard"].includes(row.lockedBy)) throw fail("not_launchable", "켤 수 없는 상태입니다.");
  const proposal = row.proposalId ? await prisma.adProposal.findFirst({ where: { id: row.proposalId, ownerId: row.ownerId }, select: { status: true } }) : null;
  if (proposal?.status !== "applied") throw fail("not_launchable", "적용이 끝난 MINTEQ 제안의 항목만 켤 수 있습니다.");
}

/** ③ 켜기 PUT 뒤 계정이 active가 아니면(해제 경합) 메모리의 키로 즉시 다시 끈다. 키가 DB에서 지워졌어도 이 실행은 키를 들고 있다. */
async function resumeRaceGuard(account: AdAccount, type: LockKind, row: MirrorLockRow, now: Date, deps: LockDeps): Promise<void> {
  const current = await prisma.adAccount.findFirst({ where: { id: account.id, ownerId: account.ownerId }, select: { status: true } });
  if (current?.status === "active") return;
  await pauseNow(account, type, row.naverId, `owner.resume_race_pause:${type}`, deps);
  await mirrorOf(prisma, type).updateMany({ where: { id: row.id }, data: { userLock: true, lockedBy: "owner", lockedAt: now, lockVersion: { increment: 1 } } });
  try {
    await queueAlert(account.id, "ads.drift", { reason: "resume_race", entity: type, naverId: row.naverId });
  } catch (error) {
    console.error("[ads] resume_race alert queue failed", { type: error instanceof Error ? error.name : "unknown" });
  }
  throw fail("resume_race", "켜는 도중 계정 연결이 해제됐습니다. 다시 껐습니다. 계정 상태를 확인하세요.");
}

async function ownerResume(type: LockKind, ownerId: string, row: MirrorLockRow, account: AdAccount, expected: number, now: Date, deps: LockDeps) {
  assertExecutionEnabled();
  if (row.lockVersion !== expected) throw versionConflict(row.lockVersion);
  if (row.lockedBy === null && !row.userLock) return lockDto(type, row); // 이미 켜져 있음
  await launchable(row, now);
  const accountCaps = caps(account);
  const mirror = mirrorOf(prisma, type);
  const claimed = expected + 1;
  return withAccountClient(account, deps, async (client) => {
    await freshCheck(client, account, type, row, mirror);
    const today = await todayCostKrw(account, client, now);
    if (today >= accountCaps.dailyCapKrw)
      throw fail("cap_reached", "오늘 광고비가 하루 상한에 도달해 켤 수 없습니다.", { todayCostKrw: today, dailyCapKrw: accountCaps.dailyCapKrw });
    const before = await claimResume(type, ownerId, row.id, expected, now, deps);
    let stored;
    try {
      stored = await putUserLock(client, account, type, row.naverId, false, { step: `owner.resume:${type}`, reason: "owner_approved" });
    } catch (error) {
      if (error instanceof NaverAdsError && error.reason === "ads_uncertain")
        await pauseNow(account, type, row.naverId, `owner.resume_uncertain_pause:${type}`, deps).catch(() => undefined);
      await mirror.updateMany({ where: { id: row.id, lockVersion: claimed }, data: { lockedBy: before.lockedBy, lockedAt: before.lockedAt, lockVersion: { increment: 1 } } });
      throw error;
    }
    await resumeRaceGuard(account, type, row, now, deps);
    const { count } = await mirror.updateMany({ where: { id: row.id, lockVersion: claimed }, data: { userLock: stored.userLock } });
    if (count !== 1) {
      // 켜기 PUT이 나가는 사이 가드(또는 다른 탭)가 잠금을 바꿨다 → 안전 방향으로 다시 끈다
      await putUserLock(client, account, type, row.naverId, true, { step: `owner.race_pause:${type}` });
      throw fail("lock_race", "켜는 도중 감시가 이 항목을 잠갔습니다. 다시 껐습니다. 상태를 확인하세요.");
    }
    return lockDto(type, (await mirror.findFirst({ where: { id: row.id, ownerId }, select: MIRROR_SELECT })) as MirrorLockRow);
  });
}

/** expectedLockVersion은 켜기에만 쓴다(끄기는 버전과 무관하게 이긴다). */
export async function setLock(ownerId: string, entity: LockEntity, locked: boolean, expectedLockVersion: number, deps: LockDeps = {}): Promise<LockResult> {
  assertAdsOwner(ownerId);
  if (deps.afterLock && process.env.NODE_ENV === "production") throw new Error("test_seam_forbidden"); // 이음새는 테스트 전용
  const { type, id } = entity;
  if (!(ADS_LOCK_ENTITY_TYPES as readonly string[]).includes(type) || !isEntityId(id)) throw notFound();
  if (typeof locked !== "boolean" || !Number.isSafeInteger(expectedLockVersion) || expectedLockVersion < 0)
    throw new AdsHttpError("bad_request", "요청 입력값을 확인하세요.", 400);
  const row = await mirrorOf(prisma, type).findFirst({ where: { id, ownerId }, select: MIRROR_SELECT });
  if (!row) throw notFound();
  const account = await loadOwnedAccount(ownerId, row.adAccountId);
  const now = (deps.now ?? (() => new Date()))();
  return locked ? ownerPause(type, ownerId, id, account, now, deps) : ownerResume(type, ownerId, row, account, expectedLockVersion, now, deps);
}
