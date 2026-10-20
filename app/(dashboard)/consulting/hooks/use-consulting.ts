// app/(dashboard)/consulting/hooks/use-consulting.ts
// 마케팅 컨설팅 패칭·생성 상태·폴링 (react-query). 표시 마크업은 담지 않는다(설계 §1.1).
// - 이력 목록: cursor 무한 조회 (GET /api/consulting)
// - 단건 상세: status==='generating' 동안만 5초 간격·최대 12회 폴링 후 수동 확인 전환
//   (POST 가 동기 생성이라 보통 completed 로 바로 돌아오나, 동시요청 409·timeout uncertain 등
//    generating 레코드가 남는 비정상 경로를 위한 안전 폴링이다 — 설계 §6.2·§6.3)
// - 생성: POST(유료 1회). 성공·실패·409 모두 해당 도메인 조회 캐시만 재검증(onSettled).
// - 도메인 전환 시 query key 분리 + GET 요청 AbortSignal 로 이전 도메인 응답이 덮지 않게 한다(설계 §7).
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useMutation,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { ConsultingReportDTO } from '../types';
import { createReport, fetchReport, listReports, type CreateReportBody } from '../api';

/** generating 폴링 상한 (무한 폴링 방지). GET 은 무과금이나 호출 폭주를 막는다. */
const MAX_POLLS = 12;
const POLL_MS = 5000;

type ConsultingSection = 'history' | 'detail';

/** 특정 도메인의 컨설팅 캐시만 무효화한다(무관한 도메인 재조회 방지). */
export function invalidateConsultingDomain(
  qc: QueryClient,
  domainId: string,
  sections: ConsultingSection[] = ['history', 'detail'],
) {
  for (const section of sections) {
    qc.invalidateQueries({
      predicate: (q) =>
        q.queryKey[0] === 'consulting' && q.queryKey[1] === section && q.queryKey[2] === domainId,
    });
  }
}

/** 리포트 이력 (cursor 무한 조회) */
export function useReportHistory(domainId: string | null, limit = 20) {
  return useInfiniteQuery({
    queryKey: ['consulting', 'history', domainId, limit],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      listReports({ domainId: domainId as string, cursor: pageParam, limit }, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!domainId,
  });
}

export interface UseReportDetailResult {
  query: UseQueryResult<ConsultingReportDTO, Error>;
  /** generating 폴링이 상한에 도달해 자동 갱신이 멈춘 상태(수동 확인 안내) */
  pollExhausted: boolean;
  /** 무과금 상세 GET 재조회 + 폴링 세션 재시작 */
  manualCheck: () => void;
}

/**
 * 단건 상세. status==='generating' 동안만 폴링하고 '실제 요청 12회'에 도달하면 멈춘다.
 * - reportId 변경·수동 확인 시 폴링 세션 초기화.
 * - generating→최종(completed/failed/uncertain) 확인 시 해당 도메인 이력 캐시 갱신.
 * - GET 은 AbortSignal 로 취소 가능 → 도메인 전환 시 이전 응답 무시(설계 §7).
 */
export function useReportDetail(domainId: string | null, reportId: string | null): UseReportDetailResult {
  const qc = useQueryClient();
  const [pollCount, setPollCount] = useState(0);

  useEffect(() => {
    setPollCount(0);
  }, [reportId]);

  const query = useQuery({
    queryKey: ['consulting', 'detail', domainId, reportId],
    queryFn: ({ signal }) => fetchReport(domainId as string, reportId as string, signal),
    enabled: !!domainId && !!reportId,
    refetchInterval: (q) => {
      if (q.state.data?.status !== 'generating') return false;
      if (pollCount >= MAX_POLLS) return false;
      return POLL_MS;
    },
  });

  // 실제 fetch 완료(true→false 전이)를 1회 요청으로 집계. generating 동안만 소진.
  const wasFetching = useRef(false);
  const status = query.data?.status;
  useEffect(() => {
    if (wasFetching.current && !query.isFetching) {
      if (query.data?.status === 'generating') {
        setPollCount((c) => Math.min(c + 1, MAX_POLLS));
      }
    }
    wasFetching.current = query.isFetching;
  }, [query.isFetching, query.data?.status]);

  // generating→최종 전이 시 해당 도메인 이력 캐시 갱신(detail 제외해 루프 방지).
  const prevStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    const prev = prevStatus.current;
    if (prev === 'generating' && status && status !== 'generating' && domainId) {
      invalidateConsultingDomain(qc, domainId, ['history']);
    }
    prevStatus.current = status;
  }, [status, domainId, qc]);

  const manualCheck = useCallback(() => {
    setPollCount(0);
    query.refetch();
  }, [query]);

  const pollExhausted = status === 'generating' && pollCount >= MAX_POLLS;

  return { query, pollExhausted, manualCheck };
}

/** 신규 생성 (POST /api/consulting) — 해당 도메인 캐시만 재검증(성공·실패·409 모두) */
export function useCreateReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateReportBody) => createReport(body),
    onSettled: (_data, _err, body) => invalidateConsultingDomain(qc, body.domainId),
  });
}
