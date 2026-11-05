// lib/analytics/content-performance-totals.ts
// 콘텐츠별 성과 합계 (순수 함수) — 측정 가능한 행만 합산한다(교차검수: 모르는 지표를 0 으로 합산 금지).
// 측정 가능 = GA4 경로 지표가 있는 행. 네이버 유입은 naver 블록 ok + 행 값(null 아님)인 행만.
import type { Ga4Block } from '@/types/ga4';
import type { PathMetrics } from '@/lib/ga4/visitors';

export interface PerfRowLike { page_path: string | null; naver_sessions: number | null }

export type PerfTotals =
  | { state: 'unavailable' }                       // GA4 블록 실패 — 상단 안내가 대신한다
  | { state: 'no_measurable'; reason: string }      // 행은 있지만 측정 가능한 행 0건
  | { state: 'ok'; measured: number; sessions: number; pageViews: number;
      naver: { state: 'ok'; measured: number; sessions: number; ratio: number | null } | { state: 'unknown' } };

export const NO_MEASURABLE_REASON = '발행 URL이 없거나 GA4 측정 도메인과 일치하지 않아 집계할 수 있는 콘텐츠가 없습니다';

export function metricsFor(block: Ga4Block<Record<string, PathMetrics>> | null | undefined, path: string | null): PathMetrics | null {
  return path && block?.state === 'ok' ? block.data[path] ?? null : null;
}

export function computePerfTotals(
  rows: PerfRowLike[],
  ga4: Ga4Block<Record<string, PathMetrics>> | null | undefined,
  naver: Ga4Block<Record<string, number>> | null | undefined,
): PerfTotals {
  if (!ga4 || ga4.state !== 'ok') return { state: 'unavailable' };
  const measured = rows.flatMap(r => { const m = metricsFor(ga4, r.page_path); return m ? [{ r, m }] : []; });
  if (measured.length === 0) return { state: 'no_measurable', reason: NO_MEASURABLE_REASON };
  const sessions = measured.reduce((s, x) => s + x.m.sessions, 0);
  const pageViews = measured.reduce((s, x) => s + x.m.screenPageViews, 0);
  const naverRows = naver?.state === 'ok' ? measured.filter(x => x.r.naver_sessions !== null) : [];
  if (naverRows.length === 0) return { state: 'ok', measured: measured.length, sessions, pageViews, naver: { state: 'unknown' } };
  const nSessions = naverRows.reduce((s, x) => s + (x.r.naver_sessions ?? 0), 0);
  const base = naverRows.reduce((s, x) => s + x.m.sessions, 0); // 비율 분모 = 같은 행들의 세션
  return { state: 'ok', measured: measured.length, sessions, pageViews,
    naver: { state: 'ok', measured: naverRows.length, sessions: nSessions, ratio: base > 0 ? nSessions / base : null } };
}
