import type { Prisma } from "@prisma/client";
import { PLAN_LIMITS, type PlanKey } from "@/lib/billing/limits";
import { VisibilityError } from "./http";
import { expireUnrecoverablePending } from "./pending";
// Conservative reservation for every in-flight paid engine and its optional judge.
export const CAPTURE_RESERVE_KRW = 1000;
/** 무료 엔진(네이버 AI 브리핑 — SerpApi 무료 요금제, 원화 비용 0)은 판정 모델(gpt-4o-mini) 비용만 예약한다. */
export const FREE_CAPTURE_RESERVE_KRW = 50;
const FREE_ENGINES = ["naver_ai_briefing"];
export function captureReserveKrw(engine: string): number {
  return FREE_ENGINES.includes(engine) ? FREE_CAPTURE_RESERVE_KRW : CAPTURE_RESERVE_KRW;
}
export function monthStartKst(now = new Date()) {
  const local = new Date(now.getTime() + 9 * 3600000);
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - 9 * 3600000,
  );
}
export interface OwnerConfig {
  plan: PlanKey;
  budgetMonthly: number;
  queryCount: number;
}
/** Caller must hold the owner row lock. Query failures propagate, never default to zero spend. */
export async function checkCaptureBudget(
  tx: Prisma.TransactionClient,
  ownerId: string,
  config: OwnerConfig,
  reserved = CAPTURE_RESERVE_KRW,
) {
  const maxQueries = PLAN_LIMITS[config.plan].visibilityQueries;
  if (maxQueries >= 0 && config.queryCount > maxQueries)
    throw new VisibilityError(
      "rate_limited",
      "플랜 질문 한도를 초과했습니다.",
      429,
    );
  let spend: number, pending: number;
  try {
    await expireUnrecoverablePending(tx, ownerId);
    const total = await tx.costLedger.aggregate({
      where: { ownerId, occurredAt: { gte: monthStartKst() } },
      _sum: { krw: true },
    });
    spend = total._sum.krw ?? 0;
    pending = await pendingReservedKrw(tx, ownerId);
    if (
      ![spend, pending, reserved, config.budgetMonthly].every(
        (v) => Number.isFinite(v) && v >= 0,
      )
    )
      throw new Error("invalid_budget");
  } catch {
    throw new VisibilityError(
      "rate_limited",
      "비용을 확인할 수 없어 수집을 보류했습니다.",
      429,
    );
  }
  if (spend >= PLAN_LIMITS[config.plan].costLimitKrw)
    throw new VisibilityError(
      "plan_limit",
      "월간 비용 한도를 초과했습니다.",
      403,
    );
  if (
    spend + pending + reserved >
    Math.min(PLAN_LIMITS[config.plan].costLimitKrw, config.budgetMonthly)
  )
    throw new VisibilityError(
      "rate_limited",
      "수집에 필요한 예산이 부족합니다.",
      429,
    );
}

/** Owner lock must be held by both GEO and SEO reserving callers. */
export async function pendingReservedKrw(
  tx: Prisma.TransactionClient,
  ownerId: string,
) {
  const [geo, geoFree, seo, consulting] = await Promise.all([
    tx.visibilitySnapshot.count({
      where: { query: { ownerId }, status: "pending" },
    }),
    tx.visibilitySnapshot.count({
      where: { query: { ownerId }, status: "pending", engine: { in: FREE_ENGINES } },
    }),
    tx.seoTask.aggregate({
      where: {
        ownerId,
        OR: [{ ledgerRecordedAt: null }, { reservedKrw: { gt: 0 } }],
      },
      _sum: { reservedKrw: true },
    }),
    tx.consultingReport.aggregate({
      where: { ownerId, OR: [{ ledgerId: null }, { reservedKrw: { gt: 0 } }] },
      _sum: { reservedKrw: true },
    }),
  ]);
  return (
    (consulting._sum.reservedKrw ?? 0) +
    (geo - geoFree) * CAPTURE_RESERVE_KRW +
    geoFree * FREE_CAPTURE_RESERVE_KRW +
    (seo._sum.reservedKrw ?? 0)
  );
}
