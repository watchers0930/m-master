// lib/ads/lock-mirror.ts — 켜기·끄기 공용: 미러 4개(캠페인·그룹·키워드·소재)의 잠금 컬럼 접근, 행 잠금, 결과 DTO, 가드 당일 판정.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AdsDeps } from "./account-core";
import { notFound } from "./account-core";
import { kstDate } from "./alerts";
import type { LockKind } from "./invariants";

export type Tx = Prisma.TransactionClient;
export const MIRROR_SELECT = {
  id: true, ownerId: true, adAccountId: true, proposalId: true, naverId: true, userLock: true, lockedBy: true, lockVersion: true, lockedAt: true,
} as const;
export type MirrorLockRow = {
  id: string; ownerId: string; adAccountId: string; proposalId: string | null; naverId: string;
  userLock: boolean; lockedBy: string | null; lockVersion: number; lockedAt: Date | null;
};
type Where = {
  id: string; ownerId?: string; lockedBy?: string | null | { not: string }; lockVersion?: number;
  OR?: { lockedBy: null | { not: string } }[];
};
type Data = { lockedBy?: string | null; lockVersion?: { increment: number }; lockedAt?: Date | null; userLock?: boolean; inspectStatus?: string | null };
export type MirrorDelegate = {
  findFirst(args: { where: Where; select: typeof MIRROR_SELECT }): Promise<MirrorLockRow | null>;
  updateMany(args: { where: Where; data: Data }): Promise<{ count: number }>;
};
const TABLES: Readonly<Record<LockKind, string>> = { campaign: "ad_campaigns", adgroup: "ad_groups", keyword: "ad_keywords", ad: "ad_creatives" };

export function mirrorOf(db: Tx | typeof prisma, type: LockKind): MirrorDelegate {
  const d = { campaign: db.adCampaign, adgroup: db.adGroup, keyword: db.adKeyword, ad: db.adCreative }[type];
  return d as unknown as MirrorDelegate; // 네 미러 모델은 잠금 컬럼이 같다
}

/** FOR UPDATE(id AND owner_id) 후 재조회. 없으면 404. */
export async function lockMirrorRow(tx: Tx, type: LockKind, id: string, ownerId: string): Promise<MirrorLockRow> {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw(TABLES[type])} WHERE id = ${id} AND owner_id = ${ownerId} FOR UPDATE`);
  const row = await mirrorOf(tx, type).findFirst({ where: { id, ownerId }, select: MIRROR_SELECT });
  if (!row) throw notFound();
  return row;
}

export type LockEntity = { type: LockKind; id: string };
/** 테스트 전용 이음새: 잠금·재조회 직후 같은 트랜잭션에서 실행된다(기본 no-op). 라우트는 이 인자를 넘기지 않는다. */
export type LockDeps = AdsDeps & { afterLock?: (tx: Tx, row: MirrorLockRow) => Promise<void> };
export type LockResult = { type: LockKind; id: string; naverId: string; userLock: boolean; lockedBy: string | null; lockVersion: number };

export const lockDto = (type: LockKind, r: MirrorLockRow): LockResult =>
  ({ type, id: r.id, naverId: r.naverId, userLock: r.userLock, lockedBy: r.lockedBy, lockVersion: r.lockVersion });

/**
 * 가드 잠금이 '오늘'인가(대장이 풀 수 없음). 자동 재개(Task 11)는 KST 0시 이후 첫 실행에서 푼다 — 대장은 lockedAt의 KST 날짜가
 * 오늘보다 이를 때(자동 재개가 누락됨)만 풀 수 있다. lockedAt 없음·미래 시각은 오늘로 본다(fail-closed).
 */
export function guardLockedToday(row: Pick<MirrorLockRow, "lockedBy" | "lockedAt">, now: Date): boolean {
  if (row.lockedBy !== "guard") return false;
  return row.lockedAt === null || kstDate(row.lockedAt) >= kstDate(now);
}
