// hooks/useGa4Analytics.ts
// 분석 화면 GA4 조회 상태 (설계 §4.7) — 표시 컴포넌트(DowHeatmap·ContentPerformanceTable)에서 패칭을 분리한다.
// GA4 오류는 블록 상태로 오므로 자동 재시도하지 않는다(사용자가 다시 시도).
'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchContentPerformance, fetchDowPattern } from '@/lib/api/ga4-analytics';
import { ga4QueryKeys } from '@/hooks/ga4QueryKeys';

export function useDowPattern(domainId: string | null) {
  return useQuery({
    queryKey: ga4QueryKeys.dowPattern(domainId),
    queryFn: ({ signal }) => fetchDowPattern(domainId, signal),
    retry: false,
  });
}

export function useContentPerformance(days: number, domainId: string | null) {
  return useQuery({
    queryKey: ga4QueryKeys.contentPerformance(days, domainId),
    queryFn: ({ signal }) => fetchContentPerformance(days, domainId, signal),
    retry: false,
  });
}
