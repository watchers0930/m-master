import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_MARKET, MARKET_ENGINES } from "@/lib/market/constants";
import { marketSchema } from "@/lib/market/schema";
import {
  checkFeatureAccess,
  checkVisibilityQueryLimit,
  PLAN_LIMITS,
  type PlanKey,
} from "@/lib/billing/limits";
import type { QueryCreateInput, QueryPatchInput } from "@/schemas/visibility";
import type {
  VisibilityQueryDTO,
  Market,
  EngineId,
  Frequency,
} from "@/types/visibility";
import { VisibilityError, notFound } from "./http";
import { logAudit } from "@/lib/audit/logger";

type DB = Prisma.TransactionClient;
export const querySelect = {
  id: true,
  domainId: true,
  query: true,
  market: true,
  engines: true,
  brandAliases: true,
  competitorAliases: true,
  frequency: true,
  active: true,
  createdAt: true,
  snapshots: {
    orderBy: { capturedAt: "desc" as const },
    take: 1,
    select: { capturedAt: true },
  },
} satisfies Prisma.VisibilityQuerySelect;
type QueryRow = Prisma.VisibilityQueryGetPayload<{
  select: typeof querySelect;
}>;
export function queryDTO(row: QueryRow): VisibilityQueryDTO {
  const { snapshots, ...rest } = row;
  return {
    ...rest,
    market: row.market as Market,
    engines: row.engines as EngineId[],
    frequency: row.frequency as Frequency,
    createdAt: row.createdAt.toISOString(),
    lastCapturedAt: snapshots[0]?.capturedAt.toISOString() ?? null,
  };
}
export function requireVisibility(plan: string) {
  try {
    checkFeatureAccess(plan, "visibility");
  } catch {
    throw new VisibilityError(
      "feature_forbidden",
      "AI 가시성은 Starter 플랜부터 사용할 수 있습니다.",
      403,
    );
  }
}
export async function lockOwner(tx: DB, ownerId: string): Promise<PlanKey> {
  const users = await tx.$queryRaw<
    { plan: string }[]
  >`SELECT plan FROM users WHERE id = ${ownerId} FOR UPDATE`;
  if (!users[0]) notFound();
  return users[0].plan in PLAN_LIMITS ? (users[0].plan as PlanKey) : "free";
}
async function domainMarket(tx: DB, ownerId: string, domainId?: string | null) {
  if (!domainId) return null;
  const domain = await tx.domain.findFirst({
    where: { id: domainId, ownerId },
    select: { market: true },
  });
  if (!domain) notFound();
  return marketSchema.parse(domain.market);
}
export function validateEngines(market: Market, engines: string[]) {
  if (!engines.every((e) => MARKET_ENGINES[market].includes(e as EngineId)))
    throw new VisibilityError(
      "bad_request",
      "이 시장에서 지원하지 않는 엔진입니다.",
      400,
    );
}
async function limit(
  tx: DB,
  ownerId: string,
  plan: string,
  reactivation = false,
) {
  if (reactivation) {
    const max = (PLAN_LIMITS[plan as PlanKey] ?? PLAN_LIMITS.free)
      .visibilityQueries;
    if (
      max < 0 ||
      (await tx.visibilityQuery.count({ where: { ownerId } })) <= max
    )
      return;
  } else {
    try {
      await checkVisibilityQueryLimit(ownerId, plan, tx);
      return;
    } catch (e) {
      if (!(e instanceof Error) || e.message !== "visibility_query_limit")
        throw e;
    }
  }
  throw new VisibilityError(
    "rate_limited",
    "추적 질문 한도를 초과했습니다.",
    429,
  );
}
export async function createQuery(ownerId: string, input: QueryCreateInput) {
  const row = await prisma.$transaction(async (tx) => {
    const plan = await lockOwner(tx, ownerId);
    requireVisibility(plan);
    await limit(tx, ownerId, plan);
    const dm = await domainMarket(tx, ownerId, input.domainId);
    const setting = await tx.setting.findUnique({
      where: { ownerId },
      select: { defaultMarket: true },
    });
    const market =
      input.market ??
      dm ??
      marketSchema.parse(setting?.defaultMarket ?? DEFAULT_MARKET);
    const engines = input.engines ?? MARKET_ENGINES[market];
    validateEngines(market, engines);
    return tx.visibilityQuery.create({
      data: {
        ...input,
        ownerId,
        market,
        engines,
        competitorAliases: input.competitorAliases ?? [],
      },
      select: querySelect,
    });
  });
  await logAudit({
    actor: ownerId,
    action: "visibility.query.create",
    targetType: "visibility_query",
    targetId: row.id,
  });
  return queryDTO(row);
}
export async function patchQuery(
  ownerId: string,
  id: string,
  input: QueryPatchInput,
) {
  const row = await prisma.$transaction(async (tx) => {
    const plan = await lockOwner(tx, ownerId);
    const current = await tx.visibilityQuery.findFirst({
      where: { id, ownerId },
      select: querySelect,
    });
    if (!current) notFound();
    if (!current.active && input.active === true) {
      requireVisibility(plan);
      await limit(tx, ownerId, plan, true);
    }
    await domainMarket(tx, ownerId, input.domainId);
    validateEngines(
      input.market ?? (current.market as Market),
      input.engines ?? current.engines,
    );
    const changed = ["query", "market", "brandAliases", "competitorAliases", "domainId"]
      .some((key) => key in input && JSON.stringify(input[key as keyof QueryPatchInput]) !== JSON.stringify(current[key as keyof typeof current]));
    if (changed) {
      await tx.visibilitySnapshot.updateMany({
        where: { queryId: id, query: { ownerId }, status: "pending" },
        data: { status: "failed", failReason: "query_configuration_changed" },
      });
    }
    if (input.active === false || input.engines) {
      await tx.visibilitySnapshot.updateMany({
        where: {
          queryId: id, query: { ownerId }, status: "pending",
          ...(input.active === false ? {} : { engine: { notIn: input.engines } }),
        },
        data: { status: "failed", failReason: "query_engine_disabled" },
      });
    }
    return tx.visibilityQuery.update({
      where: { id, ownerId },
      data: input,
      select: querySelect,
    });
  });
  await logAudit({
    actor: ownerId,
    action: "visibility.query.update",
    targetType: "visibility_query",
    targetId: id,
  });
  return queryDTO(row);
}
export async function deleteQuery(ownerId: string, id: string) {
  const deleted = await prisma.visibilityQuery.deleteMany({
    where: { id, ownerId },
  });
  if (!deleted.count) notFound();
  await logAudit({
    actor: ownerId,
    action: "visibility.query.delete",
    targetType: "visibility_query",
    targetId: id,
  });
  return { id, deleted: true as const };
}
