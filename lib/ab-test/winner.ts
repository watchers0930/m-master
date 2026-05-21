// lib/ab-test/winner.ts — 승자 자동 산정
// plan.md S7.6: sessions 차이 기반. 양쪽 0이면 'tie', 차이 < 5%면 'tie' (manual 확정 필요).

import type { AbTestPathMetrics, AbTestWinner } from '@/types/db';

export interface WinnerDecision {
  winner: AbTestWinner;
  diffPct: number;       // 0~100
  manualNeeded: boolean; // true면 사용자 manual 확정 권장
}

const TIE_THRESHOLD_PCT = 5;

export function decideWinner(
  a: AbTestPathMetrics,
  b: AbTestPathMetrics,
): WinnerDecision {
  const aSessions = a?.sessions ?? 0;
  const bSessions = b?.sessions ?? 0;

  // 양쪽 모두 0 세션 -> tie + 사용자 확정 필요
  if (aSessions === 0 && bSessions === 0) {
    return { winner: 'tie', diffPct: 0, manualNeeded: true };
  }

  const max = Math.max(aSessions, bSessions);
  const denom = Math.max(1, max);
  const diffPct = (Math.abs(aSessions - bSessions) / denom) * 100;

  if (diffPct < TIE_THRESHOLD_PCT) {
    return { winner: 'tie', diffPct, manualNeeded: true };
  }

  return {
    winner: aSessions > bSessions ? 'a' : 'b',
    diffPct,
    manualNeeded: false,
  };
}
