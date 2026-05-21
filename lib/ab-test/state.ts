// lib/ab-test/state.ts — A/B 테스트 상태 머신 / 완료 처리 공통 로직
// PATCH /api/ab-test/[id] (action='complete')과
// GET  /api/ab-test/[id]/ga4 (자동 완료 부수효과)에서 모두 사용.

import { fetchPathMetrics, type PathMetrics } from '@/lib/ga4/visitors';
import { decideWinner } from './winner';
import type {
  AbTest,
  AbTestGa4Snapshot,
  AbTestPathMetrics,
  AbTestUpdate,
  AbTestWinner,
} from '@/types/db';

export interface CompletionResult {
  ga4Snapshot: AbTestGa4Snapshot;
  winner: AbTestWinner;
  manualNeeded: boolean;
  update: AbTestUpdate;
}

function toAbMetrics(m: PathMetrics): AbTestPathMetrics {
  return {
    sessions: m.sessions,
    screenPageViews: m.screenPageViews,
    averageSessionDuration: m.averageSessionDuration,
    bounceRate: m.bounceRate,
    engagementRate: m.engagementRate,
  };
}

/**
 * 측정 기간 산정: from = started_at, to = min(now, started_at + measure_days)
 */
export function computeMeasurePeriod(test: AbTest): { from: Date; to: Date } {
  if (!test.started_at) {
    throw new Error('started_at 미설정 — period 계산 불가');
  }
  const from = new Date(test.started_at);
  const endByMeasure = new Date(from);
  endByMeasure.setDate(endByMeasure.getDate() + test.measure_days);
  const now = new Date();
  const to = endByMeasure < now ? endByMeasure : now;
  return { from, to };
}

/**
 * 측정 기간 경과 여부 (now >= started_at + measure_days)
 */
export function isMeasureWindowElapsed(test: AbTest): boolean {
  if (!test.started_at) return false;
  const start = new Date(test.started_at).getTime();
  const elapsedMs = Date.now() - start;
  return elapsedMs >= test.measure_days * 24 * 60 * 60 * 1000;
}

/**
 * GA4에서 두 변형 path 메트릭을 동시 조회하고 winner 자동 산정.
 * 호출 전제: status='running', 두 path 모두 존재.
 * GA4 API 실패 시 throw -> 호출부가 502 변환.
 */
export async function buildCompletionFromGa4(test: AbTest): Promise<CompletionResult> {
  if (!test.variant_a_path || !test.variant_b_path) {
    throw new Error('variant path 미설정 — GA4 측정 불가');
  }
  const { from, to } = computeMeasurePeriod(test);

  const [aResult, bResult] = await Promise.all([
    fetchPathMetrics(test.variant_a_path, from, to),
    fetchPathMetrics(test.variant_b_path, from, to),
  ]);
  if (aResult === null || bResult === null) {
    throw new Error('GA4 측정값 조회 실패 (null 응답)');
  }
  const aRaw = aResult;
  const bRaw = bResult;

  const a = toAbMetrics(aRaw);
  const b = toAbMetrics(bRaw);

  const decision = decideWinner(a, b);

  const snapshot: AbTestGa4Snapshot = {
    variant_a: a,
    variant_b: b,
    period: {
      from: from.toISOString(),
      to: to.toISOString(),
    },
    captured_at: new Date().toISOString(),
  };

  return {
    ga4Snapshot: snapshot,
    winner: decision.winner,
    manualNeeded: decision.manualNeeded,
    update: {
      status: 'completed',
      completed_at: new Date().toISOString(),
      winner: decision.winner,
      winner_decided_by: 'auto',
      ga4_snapshot: snapshot,
    },
  };
}
