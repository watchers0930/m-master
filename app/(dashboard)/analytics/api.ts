// app/(dashboard)/analytics/api.ts
// 분석 화면 API 래퍼 (설계 §4.7). GA4 부분은 Ga4Block — DB 지표(발행 목록)는 블록 밖에 그대로 둔다.
import type { Ga4Block } from '@/components/ga4/types';
import type { Channel } from '@/types/db';
import type { DowChannelRow, PathMetrics } from '@/lib/ga4/visitors';

export interface ContentPerformanceRow {
  content_id: string;
  title: string;
  channel: Channel;
  published_at: string | null;
  external_url: string | null;
  page_path: string | null;
  /** 네이버 유입 세션 — GA4 실패·경로 없음이면 null(0 아님) */
  naver_sessions: number | null;
}

export interface ContentPerformanceResponse {
  data: ContentPerformanceRow[];
  period: { from: string; to: string; days: number };
  /** 경로별 GA4 지표 (설계 §4.7) — 행 지표는 이 블록에서만 읽는다 */
  ga4: Ga4Block<Record<string, PathMetrics>>;
}

function qs(params: Record<string, string | number | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') q.set(k, String(v));
  return q.toString();
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  const j = await res.json().catch(() => null) as (T & { error?: { message?: string } | string | null }) | null;
  if (!res.ok || !j) {
    const e = j?.error;
    throw new Error((typeof e === 'object' ? e?.message : e) || (res.status === 404 ? '도메인을 찾을 수 없습니다' : `HTTP ${res.status}`));
  }
  return j;
}

export function fetchContentPerformance(days: number, domainId: string | null, signal?: AbortSignal) {
  return getJson<ContentPerformanceResponse>(`/api/analytics/content-performance?${qs({ days, domain_id: domainId })}`, signal);
}

export async function fetchDowPattern(domainId: string | null, signal?: AbortSignal): Promise<Ga4Block<DowChannelRow[]>> {
  const j = await getJson<{ data: Ga4Block<DowChannelRow[]> }>(`/api/analytics/ga4-pattern?${qs({ domain_id: domainId })}`, signal);
  return j.data;
}
