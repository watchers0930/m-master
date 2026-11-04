// lib/analytics/dow-pattern.ts
// GA4 요일×채널그룹 원시 행 → 우리 채널별 요일 행렬·상위 요일·합계 (순수 함수, I/O 없음).
// 기존 /api/analytics/ga4-pattern 서버 집계를 그대로 옮겼다 — 설계 §4.7 에서 응답이
// Ga4Block<DowChannelRow[]>(원시 행)으로 바뀌었기 때문. 규칙 변경 금지(스케줄러 자동편성과 동일해야 함).
// 분석 히트맵(DowHeatmap)과 스케줄러 자동편성(lib/api/schedule.ts autoSchedule)이 이 단일 구현을 공유한다.
import type { DowChannelRow } from '@/lib/ga4/visitors';

export type PatternChannel = 'blog' | 'instagram' | 'facebook';
export type ByChannel<T> = Record<PatternChannel, T>;

// GA4 sessionDefaultChannelGroup → 우리 채널 매핑
const CHANNEL_MAP: Record<string, PatternChannel> = {
  'Organic Search': 'blog',
  'Direct': 'blog',
  'Paid Search': 'blog',
  'Referral': 'blog',
  'Organic Social': 'instagram',
  'Paid Social': 'facebook',
  'Cross-network': 'facebook',
};

/** 세션이 있는 요일 중 상위 5개(요일순). 세션 없는 채널은 빈 배열 */
function topDows(arr: number[]): number[] {
  return arr
    .map((v, i) => ({ dow: i, v }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v)
    .slice(0, 5)
    .map((x) => x.dow)
    .sort((a, b) => a - b);
}

export function aggregateDowPattern(rows: DowChannelRow[]) {
  const matrix: ByChannel<number[]> = { blog: Array(7).fill(0), instagram: Array(7).fill(0), facebook: Array(7).fill(0) };
  for (const row of rows) {
    const ch = CHANNEL_MAP[row.channel];
    if (ch && row.dow >= 0 && row.dow <= 6) matrix[ch][row.dow] += row.sessions;
  }
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  return {
    matrix,
    pattern: { blog: topDows(matrix.blog), instagram: topDows(matrix.instagram), facebook: topDows(matrix.facebook) } as ByChannel<number[]>,
    totals: { blog: sum(matrix.blog), instagram: sum(matrix.instagram), facebook: sum(matrix.facebook) } as ByChannel<number>,
  };
}
