// lib/ads/locks.ts — 대장의 켜기·끄기(설계서 §5.5-7, §5.6-1 경합). 대상은 이 소유자의 미러 행(캠페인·그룹·키워드·소재).
// 끄기(locked=true): 스위치·상한과 무관하게 항상 보낸다. lockedBy='owner'로 기록한다. 단 가드 잠금(guard)은 guard로 남긴다 —
//   끄기로 가드 잠금을 owner 잠금으로 바꿔 당일 켜기 제한을 우회하지 못하게.
// 켜기(locked=false) 전제(하나라도 아니면 보내지 않는다):
//   스위치 on(503 ads_paused) · 계정 active · 미러의 제안이 applied(409 not_launchable) · lockedBy가 owner|pending_launch
//   (guard는 가드 자동 재개(Task 11)만 푼다: 잠긴 그 KST 날짜에는 409 guard_locked, 다음 날부터는 대장도 켤 수 있다 — 자동 재개가
//   드리프트로 거부된 경우의 출구) · 네이버에서 새로 읽은 값으로 재조회 대조(상한 불일치면 409 drift + 알림) · 키워드·소재는 새로 읽은
//   inspectStatus가 APPROVED|ELIGIBLE(409 not_inspected) · 오늘 비용 < dailyCapKrw(409 cap_reached, 모르면 409 spend_unknown).
// 경합: CAS는 (lockedBy, lockVersion)이다(updatedAt은 동기화 쓰기마다 바뀐다). 잠금 변경마다 lockVersion +1, 동기화는 lockVersion을 건드리지 않는다.
//   ① 트랜잭션: FOR UPDATE → 재조회 → lockVersion·lockedBy 조건부 updateMany(count=1)로 '의도'를 먼저 기록 ② 네이버 PUT
//   ③ 결과 기록은 lockVersion이 ①의 값 그대로일 때만. 켜기에서 그 사이 가드가 잠갔으면(count 0) 즉시 다시 끄고 409 lock_race.
//   켜기 PUT이 실패하면 ①의 기록을 되돌린다(불확실이면 안전 방향으로 끄기도 보낸다).
import { Prisma } from "@prisma/client";
import { NaverAdsError } from "@/lib/external/naver-searchad";
import { prisma } from "@/lib/prisma";
import { ADS_LOCK_ENTITY_TYPES } from "@/schemas/ads";
import { isEntityId } from "@/schemas/id";
import { assertAdsOwner } from "./access";
import { loadOwnedAccount, notFound, withAccountClient, type AdsDeps } from "./account-core";
import { kstDate } from "./alerts";
import { assertExecutionEnabled, putUserLock } from "./execution";
import { AdsHttpError } from "./http";
import { caps, type LockKind } from "./invariants";
import { freshCheck } from "./launch-check";
import { todayCostKrw } from "./spend";

type Tx = Prisma.TransactionClient;
const SELECT = { id: true, ownerId: true, adAccountId: true, proposalId: true, naverId: true, userLock: true, lockedBy: true, lockVersion: true, lockedAt: true } as const;
export type MirrorLockRow = { id: string; ownerId: string; adAccountId: string; proposalId: string | null; naverId: string; userLock: boolean; lockedBy: string | null; lockVersion: number; lockedAt: Date | null };
type Where = { id: string; ownerId?: string; lockedBy?: string | null; lockVersion?: number };
type Data = { lockedBy?: string | null; lockVersion?: { increment: number }; lockedAt?: Date | null; userLock?: boolean; inspectStatus?: string | null };
export type MirrorDelegate = {
  findFirst(args: { where: Where; select: typeof SELECT }): Promise<MirrorLockRow | null>;
  updateMany(args: { where: Where; data: Data }): Promise<{ count: number }>;
};
const TABLES: Readonly<Record<LockKind, string>> = { campaign: "ad_campaigns", adgroup: "ad_groups", keyword: "ad_keywords", ad: "ad_creatives" };

export function mirrorOf(db: Tx | typeof prisma, type: LockKind): MirrorDelegate {
  const d = { campaign: db.adCampaign, adgroup: db.adGroup, keyword: db.adKeyword, ad: db.adCreative }[type];
  return d as unknown as MirrorDelegate; // 네 미러 모델은 잠금 컬럼이 같다
}

export type LockEntity = { type: LockKind; id: string };
/** 테스트 전용 이음새: 잠금·재조회 직후 같은 트랜잭션에서 실행된다(기본 no-op). 라우트는 이 인자를 넘기지 않는다. */
export type LockDeps = AdsDeps & { afterLock?: (tx: Tx, row: MirrorLockRow) => Promise<void> };
export type LockResult = { type: LockKind; id: string; naverId: string; userLock: boolean; lockedBy: string | null; lockVersion: number };

const fail = (code: string, message: string, details?: Record<string, string | number | null>) => new AdsHttpError(code, message, 409, details);
const versionConflict = (current: number) =>
  fail("version_conflict", "다른 곳에서 켜기·끄기 상태가 바뀌었습니다. 최신 상태를 확인하세요.", { lock_version: current });

async function claim(type: LockKind, ownerId: string, id: string, expected: number, next: (row: MirrorLockRow) => Data, deps: LockDeps) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw(TABLES[type])} WHERE id = ${id} AND owner_id = ${ownerId} FOR UPDATE`);
    const row = await mirrorOf(tx, type).findFirst({ where: { id, ownerId }, select: SELECT });
    if (!row) throw notFound();
    await deps.afterLock?.(tx, row);
    if (row.lockVersion !== expected) throw versionConflict(row.lockVersion);
    const data = next(row);
    const { count } = await mirrorOf(tx, type).updateMany({
      where: { id, ownerId, lockedBy: row.lockedBy, lockVersion: expected }, data: { ...data, lockVersion: { increment: 1 } },
    });
    if (count !== 1) throw versionConflict(row.lockVersion);
    return row;
  });
}

const dto = (type: LockKind, r: MirrorLockRow): LockResult =>
  ({ type, id: r.id, naverId: r.naverId, userLock: r.userLock, lockedBy: r.lockedBy, lockVersion: r.lockVersion });

async function launchable(row: MirrorLockRow, now: Date): Promise<void> {
  if (row.lockedBy === "guard" && (row.lockedAt === null || kstDate(row.lockedAt) === kstDate(now)))
    throw fail("guard_locked", "오늘 하루 상한으로 감시가 멈춘 항목입니다. 내일 자동으로 다시 켜집니다.");
  if (row.lockedBy !== null && !["owner", "pending_launch", "guard"].includes(row.lockedBy)) throw fail("not_launchable", "켤 수 없는 상태입니다.");
  const proposal = row.proposalId ? await prisma.adProposal.findFirst({ where: { id: row.proposalId, ownerId: row.ownerId }, select: { status: true } }) : null;
  if (proposal?.status !== "applied") throw fail("not_launchable", "적용이 끝난 MINTEQ 제안의 항목만 켤 수 있습니다.");
}

export async function setLock(ownerId: string, entity: LockEntity, locked: boolean, expectedLockVersion: number, deps: LockDeps = {}): Promise<LockResult> {
  assertAdsOwner(ownerId);
  if (deps.afterLock && process.env.NODE_ENV === "production") throw new Error("test_seam_forbidden"); // 이음새는 테스트 전용
  const { type, id } = entity;
  if (!(ADS_LOCK_ENTITY_TYPES as readonly string[]).includes(type) || !isEntityId(id)) throw notFound();
  if (typeof locked !== "boolean" || !Number.isSafeInteger(expectedLockVersion) || expectedLockVersion < 0)
    throw new AdsHttpError("bad_request", "요청 입력값을 확인하세요.", 400);
  const row = await mirrorOf(prisma, type).findFirst({ where: { id, ownerId }, select: SELECT });
  if (!row) throw notFound();
  const account = await loadOwnedAccount(ownerId, row.adAccountId);
  const now = (deps.now ?? (() => new Date()))();
  const mirror = mirrorOf(prisma, type);
  const read = async () => dto(type, (await mirror.findFirst({ where: { id, ownerId }, select: SELECT })) as MirrorLockRow);
  const claimed = expectedLockVersion + 1;

  if (locked) {
    if (row.lockVersion !== expectedLockVersion) throw versionConflict(row.lockVersion);
    return withAccountClient(account, deps, async (client) => {
      await claim(type, ownerId, id, expectedLockVersion, (r) => (r.lockedBy === "guard" ? {} : { lockedBy: "owner", lockedAt: now }), deps);
      const stored = await putUserLock(client, account, type, row.naverId, true, { step: `owner.pause:${type}` });
      await mirror.updateMany({ where: { id, lockVersion: claimed }, data: { userLock: stored.userLock } });
      return read();
    });
  }

  assertExecutionEnabled();
  if (row.lockVersion !== expectedLockVersion) throw versionConflict(row.lockVersion);
  if (row.lockedBy === null && !row.userLock) return dto(type, row); // 이미 켜져 있음
  await launchable(row, now);
  const accountCaps = caps(account);
  return withAccountClient(account, deps, async (client) => {
    await freshCheck(client, account, type, row, mirror);
    const today = await todayCostKrw(account, client, now);
    if (today >= accountCaps.dailyCapKrw)
      throw fail("cap_reached", "오늘 광고비가 하루 상한에 도달해 켤 수 없습니다.", { todayCostKrw: today, dailyCapKrw: accountCaps.dailyCapKrw });
    const before = await claim(type, ownerId, id, expectedLockVersion, (r) => {
      if (r.lockedBy === "guard" && (r.lockedAt === null || kstDate(r.lockedAt) === kstDate(now))) throw fail("guard_locked", "오늘 하루 상한으로 감시가 멈춘 항목입니다.");
      return { lockedBy: null, lockedAt: now };
    }, deps);
    let stored;
    try {
      stored = await putUserLock(client, account, type, row.naverId, false, { step: `owner.resume:${type}`, reason: "owner_approved" });
    } catch (error) {
      if (error instanceof NaverAdsError && error.reason === "ads_uncertain")
        await putUserLock(client, account, type, row.naverId, true, { step: `owner.resume_uncertain_pause:${type}` }).catch(() => undefined);
      await mirror.updateMany({ where: { id, lockVersion: claimed }, data: { lockedBy: before.lockedBy, lockedAt: before.lockedAt, lockVersion: { increment: 1 } } });
      throw error;
    }
    const { count } = await mirror.updateMany({ where: { id, lockVersion: claimed }, data: { userLock: stored.userLock } });
    if (count !== 1) {
      // 켜기 PUT이 나가는 사이 가드(또는 다른 탭)가 잠금을 바꿨다 → 안전 방향으로 다시 끈다
      await putUserLock(client, account, type, row.naverId, true, { step: `owner.race_pause:${type}` });
      throw fail("lock_race", "켜는 도중 감시가 이 항목을 잠갔습니다. 다시 껐습니다. 상태를 확인하세요.");
    }
    return read();
  });
}
