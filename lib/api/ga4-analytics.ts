// lib/api/ga4-analytics.ts
// 분석 화면·스케줄러 자동편성 공용 GA4 API 래퍼 (설계 §4.7). GA4 부분은 Ga4Block — DB 지표(발행 목록)는 블록 밖에 그대로 둔다.
import type { Ga4Block } from '@/types/ga4';
import type { DowChannelRow } from '@/lib/ga4/visitors';

// 응답 계약 단일 출처 = lib/ga4/content-performance.ts (type-only, 런타임 import 없음).
// ga4(경로 지표)·naver(네이버 유입) 블록은 독립 실패 — 행 지표는 각 블록에서만 읽는다.
export type { ContentPerformanceRow, ContentPerformanceResponse } from '@/lib/ga4/content-performance';
import type { ContentPerformanceResponse } from '@/lib/ga4/content-performance';

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
