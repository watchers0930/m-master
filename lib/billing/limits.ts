// lib/billing/limits.ts — 플랜별 사용량 제한
import { prisma } from '@/lib/prisma';

export const PLAN_LIMITS = {
  free:    { contentPerMonth: 5,  costLimitKrw: 10_000,  channels: 1 },
  starter: { contentPerMonth: 30, costLimitKrw: 100_000, channels: 3 },
  pro:     { contentPerMonth: -1, costLimitKrw: 500_000, channels: -1 }, // -1 = 무제한
} as const;

export type PlanKey = keyof typeof PLAN_LIMITS;

export async function checkContentLimit(userId: string, plan: string): Promise<void> {
  const limits = PLAN_LIMITS[plan as PlanKey] ?? PLAN_LIMITS.free;
  if (limits.contentPerMonth < 0) return; // 무제한

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const count = await prisma.content.count({
    where: {
      ownerId: userId,
      createdAt: { gte: monthStart },
    },
  });

  if (count >= limits.contentPerMonth) {
    throw new Error(`월간 콘텐츠 한도 초과 (${limits.contentPerMonth}건). 플랜을 업그레이드하세요.`);
  }
}

export async function checkCostLimit(userId: string, plan: string): Promise<void> {
  const limits = PLAN_LIMITS[plan as PlanKey] ?? PLAN_LIMITS.free;
  if (limits.costLimitKrw < 0) return;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const result = await prisma.costLedger.aggregate({
    where: {
      ownerId: userId,
      occurredAt: { gte: monthStart },
    },
    _sum: { krw: true },
  });

  const totalKrw = result._sum.krw ?? 0;
  if (totalKrw >= limits.costLimitKrw) {
    throw new Error(`월간 AI 비용 한도 초과 (${limits.costLimitKrw.toLocaleString()}원). 플랜을 업그레이드하세요.`);
  }
}
