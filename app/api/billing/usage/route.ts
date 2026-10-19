// GET /api/billing/usage — 이번 달 사용량 조회
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { PLAN_LIMITS, type PlanKey } from "@/lib/billing/limits";
import { authenticated } from "@/lib/visibility/http";
import { monthStartKst } from "@/lib/visibility/budget";

export async function GET() {
  return authenticated(async (userId) => {
    const monthStart = monthStartKst();

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true },
    });

    const [contentCount, costAgg, queryCount, visibilityCost] =
      await Promise.all([
        prisma.content.count({
          where: { ownerId: userId, createdAt: { gte: monthStart } },
        }),
        prisma.costLedger.aggregate({
          where: { ownerId: userId, occurredAt: { gte: monthStart } },
          _sum: { krw: true },
        }),
        prisma.visibilityQuery.count({ where: { ownerId: userId } }),
        prisma.costLedger.aggregate({
          where: {
            ownerId: userId,
            kind: "visibility",
            occurredAt: { gte: monthStart },
          },
          _sum: { krw: true },
        }),
      ]);

    return NextResponse.json({
      data: {
        plan: user?.plan ?? "free",
        visibility: {
          queryCount,
          queryLimit: (PLAN_LIMITS[user?.plan as PlanKey] ?? PLAN_LIMITS.free)
            .visibilityQueries,
          monthlyVisibilityCostKrw: Math.round(visibilityCost._sum.krw ?? 0),
        },
        contentCount,
        costKrw: Math.round(costAgg._sum.krw ?? 0),
      },
      error: null,
    });
  });
}
