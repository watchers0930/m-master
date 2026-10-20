import type { Prisma } from "@prisma/client";
import { PLAN_LIMITS, type PlanKey } from "@/lib/billing/limits";
import { monthStartKst, pendingReservedKrw } from "@/lib/visibility/budget";
import { VisibilityError } from "@/lib/visibility/http";
import { usdToKrw } from "@/lib/external/dataforseo";
// Deployment supplies a reviewed per-operation USD ceiling and supported markets.
// No guessed prices: missing/unverified ceilings disable new paid submissions.
export function estimate(operation: string, units = 1): number {
  try {
    const config = JSON.parse(process.env.SEO_VERIFIED_PRICING_JSON ?? "{}");
    const price = config[operation];
    if (
      !price ||
      typeof price.usdPerUnit !== "number" ||
      price.usdPerUnit <= 0 ||
      !Number.isFinite(price.usdPerUnit) ||
      !Number.isFinite(Date.parse(price.verifiedAt)) ||
      Date.now() - Date.parse(price.verifiedAt) > 30 * 86400000 ||
      Date.parse(price.verifiedAt) > Date.now()
    )
      throw new Error();
    const total = Math.ceil(usdToKrw(price.usdPerUnit * units) * 1.25);
    if (!Number.isFinite(total) || total <= 0) throw new Error();
    return total;
  } catch {
    throw new VisibilityError(
      "rate_limited",
      "검증된 비용 상한이 없어 실행을 보류했습니다.",
      429,
    );
  }
}
export function supported(operation: string, market: string) {
  if (operation === "naver_volume") return false;
  try {
    const c = JSON.parse(process.env.SEO_VERIFIED_PRICING_JSON ?? "{}");
    return (
      Array.isArray(c[operation]?.markets) &&
      c[operation].markets.includes(market)
    );
  } catch {
    return false;
  }
}
export async function checkSeoBudget(
  tx: Prisma.TransactionClient,
  ownerId: string,
  plan: PlanKey,
  extra = 0,
) {
  try {
    const [settings, total, pending] = await Promise.all([
      tx.setting.findUnique({
        where: { ownerId },
        select: { budgetMonthly: true },
      }),
      tx.costLedger.aggregate({
        where: { ownerId, occurredAt: { gte: monthStartKst() } },
        _sum: { krw: true },
      }),
      pendingReservedKrw(tx, ownerId),
    ]);
    const spend = total._sum.krw ?? 0;
    if (
      ![spend, pending, extra, settings?.budgetMonthly].every(
        (v) => typeof v === "number" && Number.isFinite(v) && v >= 0,
      )
    )
      throw new Error("invalid_budget");
    if (spend >= PLAN_LIMITS[plan].costLimitKrw)
      throw new VisibilityError(
        "plan_limit",
        "월 비용 한도를 초과했습니다.",
        403,
      );
    if (
      !settings ||
      spend + pending + extra >
        Math.min(settings.budgetMonthly, PLAN_LIMITS[plan].costLimitKrw)
    )
      throw new VisibilityError(
        "rate_limited",
        "진단에 필요한 예산이 부족합니다.",
        429,
      );
  } catch (e) {
    if (e instanceof VisibilityError) throw e;
    throw new VisibilityError(
      "rate_limited",
      "비용 확인에 실패하여 실행을 보류했습니다.",
      429,
    );
  }
}
