// lib/cost/tracker.ts — cost_ledger 적재 (서버 전용)

import { prisma } from '@/lib/prisma';

export type CostKind = 'chat' | 'embedding' | 'image';

export interface TrackCostOptions {
  kind: CostKind;
  tokensIn: number;
  tokensOut: number;
  krw: number;
  contentId?: string | null;
}

export async function trackCost(options: TrackCostOptions): Promise<void> {
  try {
    await prisma.costLedger.create({
      data: {
        kind: options.kind,
        tokensIn: options.tokensIn,
        tokensOut: options.tokensOut,
        krw: options.krw,
        contentId: options.contentId ?? null,
      },
    });
  } catch (error) {
    // cost 적재 실패는 서비스 중단 불필요 — 로그만 기록
    console.error('[cost/tracker] costLedger insert 실패:', error);
  }
}

// ----------------------------------------------------------------
// 이번 달 누적 비용 조회 (budget.ts에서 사용)
// ----------------------------------------------------------------
export async function getMonthlySpendKrw(): Promise<number> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  try {
    const rows = await prisma.costLedger.findMany({
      where: {
        occurredAt: { gte: startOfMonth },
      },
      select: { krw: true },
    });

    return rows.reduce((sum, row) => sum + (row.krw ?? 0), 0);
  } catch (error) {
    console.error('[cost/tracker] getMonthlySpendKrw 실패:', error);
    return 0;
  }
}
