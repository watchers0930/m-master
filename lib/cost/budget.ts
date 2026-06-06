// lib/cost/budget.ts — 월 예산 체크 및 알림 판단 (서버 전용)

import { prisma } from '@/lib/prisma';
import { getMonthlySpendKrw } from '@/lib/cost/tracker';

interface BudgetStatus {
  budgetMonthly: number;
  spentKrw: number;
  remainingKrw: number;
  usageRatio: number;
  alertThreshold: number;
  shouldAlert: boolean;
  exceeded: boolean;
}

async function getBudgetStatus(ownerId?: string): Promise<BudgetStatus> {
  try {
    let settingsData: { budgetMonthly: number; alertThreshold: number } | null = null;

    if (ownerId) {
      settingsData = await prisma.setting.findUnique({
        where: { ownerId },
        select: { budgetMonthly: true, alertThreshold: true },
      });
    }

    if (!settingsData) {
      return buildStatus(500_000, 0.8, 0);
    }

    const budgetMonthly: number = settingsData.budgetMonthly ?? 500_000;
    const alertThreshold: number = settingsData.alertThreshold ?? 0.8;
    const spentKrw = await getMonthlySpendKrw(ownerId);

    return buildStatus(budgetMonthly, alertThreshold, spentKrw);
  } catch (error) {
    console.error('[cost/budget] settings 조회 실패:', error);
    return buildStatus(500_000, 0.8, 0);
  }
}

function buildStatus(
  budgetMonthly: number,
  alertThreshold: number,
  spentKrw: number,
): BudgetStatus {
  const remainingKrw = budgetMonthly - spentKrw;
  const usageRatio = budgetMonthly > 0 ? spentKrw / budgetMonthly : 1;

  return {
    budgetMonthly,
    spentKrw,
    remainingKrw,
    usageRatio,
    alertThreshold,
    shouldAlert: usageRatio >= alertThreshold,
    exceeded: usageRatio >= 1.0,
  };
}

export async function isBudgetExceeded(ownerId?: string): Promise<boolean> {
  const status = await getBudgetStatus(ownerId);
  return status.exceeded;
}
