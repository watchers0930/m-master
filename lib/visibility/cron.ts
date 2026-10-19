import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PLAN_LIMITS, type PlanKey } from "@/lib/billing/limits";
import { capture } from "./track";
import { kstDate, periodRange } from "./run-key";
import type { Frequency } from "@/types/visibility";
import { CAPTURE_LEASE_MS, expireUnrecoverablePending } from "./pending";
import { ENGINE_IDS } from "@/lib/market/constants";
export function dueQueries(
  frequency: Frequency | undefined,
  now: Date,
): Prisma.VisibilityQueryWhereInput {
  const monday = new Date(`${kstDate(now)}T00:00:00Z`).getUTCDay() === 1;
  const frequencies: Frequency[] = frequency
    ? [frequency]
    : monday
      ? ["daily", "weekly"]
      : ["daily"];
  return {
    active: true,
    AND: [{ OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }],
    owner: { plan: { in: ["starter", "pro"] } },
    ...(frequency ? { frequency } : {}),
    OR: [
      // Resume known pending tasks even after their weekly/day bucket has ended.
      {
        snapshots: {
          some: {
            status: "pending",
            capturedAt: { lt: new Date(now.getTime() - CAPTURE_LEASE_MS) },
            OR: [
              { taskId: { not: null } },
              { rawJson: { not: Prisma.DbNull } },
            ],
          },
        },
      },
      ...frequencies.map((f) => ({
        frequency: f,
        OR: ENGINE_IDS.map((engine) => ({
          engines: { has: engine },
          AND: [
            {
              snapshots: {
                none: {
                  engine,
                  capturedAt: periodRange(f, now),
                },
              },
            },
            { snapshots: { none: { engine, status: "pending" } } },
          ],
        })),
      })),
    ],
  };
}
export async function captureBatch(input: {
  frequency?: Frequency;
  limit: number;
}) {
  await expireUnrecoverablePending(prisma);
  const queries = await prisma.visibilityQuery.findMany({
    where: dueQueries(input.frequency, new Date()),
    select: { id: true, ownerId: true, attemptFailures: true },
    take: input.limit,
    orderBy: [{ lastCheckedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }, { id: "asc" }],
  });
  const owners = [...new Set(queries.map((q) => q.ownerId))];
  const users = await prisma.user.findMany({
    where: { id: { in: owners } },
    select: {
      id: true,
      plan: true,
      settings: { select: { budgetMonthly: true } },
      _count: { select: { visibilityQueries: true } },
    },
  });
  const configs = new Map(
    users.map((user) => [
      user.id,
      {
        plan: (user.plan in PLAN_LIMITS ? user.plan : "free") as PlanKey,
        budgetMonthly: user.settings[0]?.budgetMonthly ?? 500000,
        queryCount: user._count.visibilityQueries,
      },
    ]),
  );
  const counts = { processed: 0, skipped: 0, failed: 0 };
  const started = Date.now();
  for (const query of queries) {
    let retry = true;
    const checkedAt = new Date();
    const defer = async () => {
      const failures = Math.min(query.attemptFailures + 1, 16);
      await prisma.visibilityQuery.updateMany({
        where: { id: query.id, ownerId: query.ownerId },
        data: {
          lastCheckedAt: checkedAt,
          attemptFailures: retry ? failures : 0,
          nextAttemptAt: retry ? new Date(checkedAt.getTime() + Math.min(86400000, 60000 * 2 ** (failures - 1))) : null,
        },
      });
    };
    // Worst-case one query: two waves, four bounded HTTP operations + one judge per wave.
    if (Date.now() - started > 40000) {
      counts.skipped++;
      await defer();
      continue;
    }
    const config = configs.get(query.ownerId);
    if (
      !config ||
      !PLAN_LIMITS[config.plan].visibility ||
      (PLAN_LIMITS[config.plan].visibilityQueries >= 0 &&
        config.queryCount > PLAN_LIMITS[config.plan].visibilityQueries)
    ) {
      counts.skipped++;
      await defer();
      continue;
    }
    try {
      const result = await capture(query.ownerId, query.id, undefined, {
        ownerConfig: config,
      });
      if (!result.length) counts.skipped++;
      else if (result.every((r) => r.status === "failed")) counts.failed++;
      else {
        counts.processed++;
        retry = result.some((r) => r.status === "pending" || r.status === "failed");
      }
    } catch {
      counts.failed++;
    }
    await defer();
  }
  return counts;
}
