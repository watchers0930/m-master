// app/(dashboard)/seo-audit/hooks/use-seo-audit.ts
// SEO 진단 실행·조회·재개 패칭·상태 (react-query).
// - 이력 목록: keyset 무한 조회 (GET /api/seo/audit)
// - 단건 상세: pending 동안만 5초 간격·최대 10회 폴링 후 수동 확인 전환 (설계 §1.3)
//   폴링 횟수는 interval 계산이 아니라 '실제 fetch 완료'로만 센다(관찰자 재평가에 오염되지 않도록).
// - 실행/재개: POST(과금 가능). 성공·실패 모두 조회 캐시 재검증(onSettled).
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
import type { SeoAuditDTO } from '@/types/seo';
import {
  listAudits,
  fetchAuditDetail,
  runAudit,
  resumeAudit,
  type RunAuditBody,
} from '../api';

/** 폴링 상한 (설계 §1.3: 최대 10회·5초 간격 후 수동 확인) */
const MAX_POLLS = 10;
const POLL_MS = 5000;

type SeoSection = 'audits' | 'keywords' | 'rankings' | 'audit-detail';

/**
 * 특정 도메인의 조회 캐시만 무효화한다(무관한 도메인 재조회 방지, 리뷰 지적 8).
 * 키 구조: audits/audit-detail=['seo',section,domainId,...], keywords/rankings=['seo',section,{domainId,...}].
 */
export function invalidateSeoDomain(
  qc: QueryClient,
  domainId: string,
  sections: SeoSection[] = ['audits', 'keywords', 'rankings', 'audit-detail'],
) {
  for (const section of sections) {
    qc.invalidateQueries({
      predicate: (q) => {
        if (q.queryKey[0] !== 'seo' || q.queryKey[1] !== section) return false;
        const k2 = q.queryKey[2];
        const kid = typeof k2 === 'string' ? k2 : (k2 as { domainId?: string } | undefined)?.domainId;
        return kid === domainId;
      },
    });
  }
}

/** 진단 이력 (keyset 무한 조회) */
export function useAuditHistory(domainId: string | null, limit = 50) {
  return useInfiniteQuery({
    queryKey: ['seo', 'audits', domainId, limit],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listAudits({ domainId: domainId as string, cursor: pageParam, limit }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!domainId,
  });
}

export interface UseAuditDetailResult {
  query: UseQueryResult<SeoAuditDTO, Error>;
  /** pending 폴링이 상한에 도달해 자동 갱신이 멈춘 상태(수동 확인 안내) */
  pollExhausted: boolean;
  /** 무과금 상세 GET 재조회 + 폴링 세션 재시작 */
  manualCheck: () => void;
}

/**
 * 단건 상세. pending 동안만 폴링하고 '실제 요청 10회'에 도달하면 멈춘다(무한 폴링·과금 폭주 방지).
 * - auditId 변경·재개(비pending→pending 재진입)·수동 확인 시 폴링 세션을 초기화한다.
 * - 폴링으로 최종 상태(완료/부분/실패)를 확인하면 해당 도메인 목록 캐시를 갱신한다(리뷰 지적 8).
 */
export function useAuditDetail(domainId: string | null, auditId: string | null): UseAuditDetailResult {
  const qc = useQueryClient();
  const [pollCount, setPollCount] = useState(0);

  // auditId 가 바뀌면 폴링 카운터 초기화
  useEffect(() => {
    setPollCount(0);
  }, [auditId]);

  const query = useQuery({
    queryKey: ['seo', 'audit-detail', domainId, auditId],
    queryFn: () => fetchAuditDetail(domainId as string, auditId as string),
    enabled: !!domainId && !!auditId,
    // 상태 변화·옵션 갱신이 아니라 타이머로만 재요청. 카운트는 여기서 '세지 않는다'(순수 함수).
    refetchInterval: (q) => {
      if (q.state.data?.status !== 'pending') return false;
      if (pollCount >= MAX_POLLS) return false;
      return POLL_MS;
    },
  });

  // 실제 fetch 완료(true→false 전이)를 1회 요청으로 집계한다. pending 동안만 소진.
  const wasFetching = useRef(false);
  const status = query.data?.status;
  useEffect(() => {
    if (wasFetching.current && !query.isFetching) {
      if (query.data?.status === 'pending') {
        setPollCount((c) => Math.min(c + 1, MAX_POLLS));
      }
    }
    wasFetching.current = query.isFetching;
  }, [query.isFetching, query.data?.status]);

  // 상태 전이 처리: (1) 비pending→pending 재진입 = 재개 → 세션 재시작,
  //              (2) pending→최종 = 목록 캐시 갱신(해당 도메인만, audit-detail 제외해 루프 방지).
  const prevStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    const prev = prevStatus.current;
    if (prev && prev !== 'pending' && status === 'pending') {
      setPollCount(0);
    }
    if (prev === 'pending' && status && status !== 'pending' && domainId) {
      invalidateSeoDomain(qc, domainId, ['audits', 'keywords', 'rankings']);
    }
    prevStatus.current = status;
  }, [status, domainId, qc]);

  const manualCheck = useCallback(() => {
    setPollCount(0); // 폴링 세션 재시작
    query.refetch(); // GET 만 호출(무과금)
  }, [query]);

  const pollExhausted = status === 'pending' && pollCount >= MAX_POLLS;

  return { query, pollExhausted, manualCheck };
}

/** 신규 진단 실행 (POST /api/seo/audit) — 해당 도메인 캐시만 재검증 */
export function useRunAudit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RunAuditBody) => runAudit(body),
    onSettled: (_data, _err, body) => invalidateSeoDomain(qc, body.domainId),
  });
}

/** 기존 실행 재개 (POST /api/seo/audit/[id]/resume) */
export function useResumeAudit(domainId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (auditId: string) => resumeAudit(auditId),
    onSettled: (data) => {
      // 응답 DTO 의 domainId 를 우선 사용(없으면 현재 선택 도메인)
      const id = data?.domainId ?? domainId;
      if (id) invalidateSeoDomain(qc, id);
    },
  });
}
