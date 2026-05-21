// lib/dashboard/grades.ts — 대시보드 등급·변화율 헬퍼

/**
 * contents.scores.avg 기준으로 등급 배지를 반환.
 * avg 없음(null/undefined) → { letter: '—', cls: 'gm' }
 * 90 이상 → A/ga
 * 75 이상 → B/gb
 * 그 외   → C/gc
 */
export function gradeFromScore(
  avg: number | null | undefined,
): { letter: 'A' | 'B' | 'C' | '—'; cls: 'ga' | 'gb' | 'gc' | 'gm' } {
  if (avg == null) return { letter: '—', cls: 'gm' };
  if (avg >= 90) return { letter: 'A', cls: 'ga' };
  if (avg >= 75) return { letter: 'B', cls: 'gb' };
  return { letter: 'C', cls: 'gc' };
}

/**
 * 이번달 vs 지난달 방문자 증감률 (%).
 * cur 또는 prev가 null이거나 prev === 0이면 null 반환.
 */
export function calcMonthDelta(
  cur: number | null,
  prev: number | null,
): number | null {
  if (cur == null || prev == null) return null;
  if (prev === 0) return null;
  return ((cur - prev) / prev) * 100;
}

/**
 * AI 평균 검수 점수 이번달 vs 지난달 차이 (점).
 * cur 또는 prev가 null이면 null 반환.
 */
export function calcScoreDelta(
  cur: number | null,
  prev: number | null,
): number | null {
  if (cur == null || prev == null) return null;
  return Math.round(cur - prev);
}

/**
 * 현재 날짜 기준으로 다음달 정보를 반환.
 * 12월 → 다음해 1월 처리 포함.
 */
export function nextMonthInfo(now: Date): {
  year: number;
  month: number;
  monthStr: string;   // 'YYYY-MM'
  ymdStart: string;   // 'YYYY-MM-01'
} {
  const m = now.getMonth() + 1; // 1-12
  const nextM = m === 12 ? 1 : m + 1;
  const nextY = m === 12 ? now.getFullYear() + 1 : now.getFullYear();
  const monthStr = `${nextY}-${String(nextM).padStart(2, '0')}`;
  return { year: nextY, month: nextM, monthStr, ymdStart: `${monthStr}-01` };
}
