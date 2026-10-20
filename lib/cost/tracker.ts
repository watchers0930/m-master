// lib/cost/tracker.ts — cost_ledger 적재 (서버 전용)

import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

export type CostKind = 'chat' | 'embedding' | 'image' | 'external' | 'visibility' | 'seo' | 'consulting';

export interface TrackCostOptions {
  ownerId: string;
  kind: CostKind;
  tokensIn: number;
  tokensOut: number;
  krw: number;
  contentId?: string | null;
}

export async function trackCost(options: TrackCostOptions, config?: { strict?: boolean; db?: Prisma.TransactionClient }): Promise<void> {
  try {
    await (config?.db ?? prisma).costLedger.create({
      data: {
        ownerId: options.ownerId,
        kind: options.kind,
        tokensIn: options.tokensIn,
        tokensOut: options.tokensOut,
        krw: options.krw,
        contentId: options.contentId ?? null,
      },
    });
  } catch (error) {
    if (config?.strict) throw error;
    // 기존 호출부의 동작 유지
    console.error('[cost/tracker] costLedger insert 실패:', error);
  }
}

// ----------------------------------------------------------------
// 이번 달 누적 비용 조회 (budget.ts에서 사용)
// ----------------------------------------------------------------
export async function getMonthlySpendKrw(ownerId?: string): Promise<number> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  try {
    const where: Record<string, unknown> = {
      occurredAt: { gte: startOfMonth },
    };
    if (ownerId) where.ownerId = ownerId;

    const rows = await prisma.costLedger.findMany({
      where,
      select: { krw: true },
    });

    return rows.reduce((sum, row) => sum + (row.krw ?? 0), 0);
  } catch (error) {
    console.error('[cost/tracker] getMonthlySpendKrw 실패:', error);
    return 0;
  }
}
