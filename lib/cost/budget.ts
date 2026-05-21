// lib/cost/budget.ts — 월 예산 체크 및 알림 판단 (서버 전용)
// plan.md S2.2: 월 50만원 한도, 80% 알림, 100% 초과 시 429

import { prisma } from '@/lib/prisma';
import { getMonthlySpendKrw } from '@/lib/cost/tracker';

export interface BudgetStatus {
  budgetMonthly: number;   // 설정된 월 한도 (KRW)
  spentKrw: number;        // 이번 달 누적 지출
  remainingKrw: number;    // 잔여
  usageRatio: number;      // 0.0 ~ 1.0+
  alertThreshold: number;  // 알림 기준 (0.8 기본)
  shouldAlert: boolean;    // 80% 이상
  exceeded: boolean;       // 100% 초과
}

export async function getBudgetStatus(): Promise<BudgetStatus> {
  try {
    // settings 테이블에서 예산 한도 조회
    const settingsData = await prisma.setting.findUnique({
      where: { id: 1 },
      select: { budgetMonthly: true, alertThreshold: true },
    });

    if (!settingsData) {
      console.error('[cost/budget] settings 조회 실패: 레코드 없음');
      // 기본값으로 fallback (안전한 방향)
      return buildStatus(500_000, 0.8, 0);
    }

    const budgetMonthly: number = settingsData.budgetMonthly ?? 500_000;
    const alertThreshold: number = settingsData.alertThreshold ?? 0.8;

    const spentKrw = await getMonthlySpendKrw();

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

// ----------------------------------------------------------------
// 예산 초과 여부만 빠르게 확인 (generate 직전 호출용)
// exceeded = true -> 호출부에서 429 반환
// ----------------------------------------------------------------
export async function isBudgetExceeded(): Promise<boolean> {
  const status = await getBudgetStatus();
  return status.exceeded;
}
