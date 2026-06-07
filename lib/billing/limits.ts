// lib/billing/limits.ts — 플랜별 사용량 제한 + 기능 게이트
import { prisma } from '@/lib/prisma';

export const PLAN_LIMITS = {
  free:    { contentPerMonth: 5,  costLimitKrw: 10_000,  channels: 1,  rag: false, abTest: false },
  starter: { contentPerMonth: 30, costLimitKrw: 100_000, channels: 3,  rag: true,  abTest: false },
  pro:     { contentPerMonth: -1, costLimitKrw: 500_000, channels: -1, rag: true,  abTest: true }, // -1 = 무제한
} as const;

export type PlanKey = keyof typeof PLAN_LIMITS;
export type FeatureKey = 'rag' | 'abTest';

/** DB에서 유저 플랜 조회 (API route에서 간편 사용) */
export async function getUserPlan(userId: string): Promise<PlanKey> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true },
  });
  const plan = user?.plan ?? 'free';
  return (plan in PLAN_LIMITS) ? plan as PlanKey : 'free';
}

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

/** 채널 수 제한 체크 (활성 채널 수 vs 플랜 한도) */
export async function checkChannelLimit(userId: string, plan: string): Promise<void> {
  const limits = PLAN_LIMITS[plan as PlanKey] ?? PLAN_LIMITS.free;
  if (limits.channels < 0) return; // 무제한

  // 활성 채널 = ChannelCredential + CafeTarget 수
  const [credCount, cafeTargetCount] = await Promise.all([
    prisma.channelCredential.count({ where: { ownerId: userId } }),
    prisma.cafeTarget.count({ where: { ownerId: userId } }),
  ]);

  // 카페 타겟은 naver_cafe 채널의 하위이므로, credential 없이 타겟만 있으면 1채널
  const totalChannels = credCount + (cafeTargetCount > 0 && credCount === 0 ? 1 : 0);

  if (totalChannels >= limits.channels) {
    throw new Error(`채널 한도 초과 (최대 ${limits.channels}개). 플랜을 업그레이드하세요.`);
  }
}

/** 기능 접근 체크 (rag, abTest 등) */
export function checkFeatureAccess(plan: string, feature: FeatureKey): void {
  const limits = PLAN_LIMITS[plan as PlanKey] ?? PLAN_LIMITS.free;
  if (!limits[feature]) {
    const featureNames: Record<FeatureKey, string> = {
      rag: 'RAG (자료 기반 생성)',
      abTest: 'A/B 테스트',
    };
    throw new Error(`${featureNames[feature]}은(는) ${plan === 'free' ? 'Starter' : 'Pro'} 플랜부터 사용 가능합니다.`);
  }
}
