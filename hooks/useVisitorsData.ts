// hooks/useVisitorsData.ts
// 방문자 분석 조회 상태 (GET /api/visitors/data · /realtime, 설계 §4.7).
// 기간·도메인별 캐시. 실시간은 30초 폴링(기존 주기 유지). 15초 초과 요청은 중단한다(기존 동작 유지).
'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchRealtime, fetchVisitorsData, type VisitorPeriod } from '@/lib/api/visitors';
import { ga4QueryKeys } from '@/hooks/ga4QueryKeys';

const TIMEOUT_MS = 15_000;

// AbortSignal.any 는 구형 Safari 미지원 — 수동 연결
function withTimeout(signal: AbortSignal): AbortSignal {
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), TIMEOUT_MS);
  const stop = () => { clearTimeout(timer); c.abort(); };
  if (signal.aborted) stop();
  else signal.addEventListener('abort', stop, { once: true });
  return c.signal;
}

export function useVisitorsData(period: VisitorPeriod, domainId: string | null) {
  return useQuery({
    queryKey: ga4QueryKeys.visitors(period, domainId),
    queryFn: ({ signal }) => fetchVisitorsData(period, domainId, withTimeout(signal)),
    staleTime: 5 * 60_000,
    retry: false, // GA4 오류는 블록 상태로 오며, 요청 자체 실패는 사용자가 다시 시도
  });
}

export function useRealtimeVisitors(domainId: string | null) {
  return useQuery({
    queryKey: ga4QueryKeys.realtime(domainId),
    queryFn: ({ signal }) => fetchRealtime(domainId, withTimeout(signal)),
    refetchInterval: 30_000,
    retry: false,
  });
}
