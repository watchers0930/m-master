// app/(dashboard)/seo-audit/hooks/use-seo-rankings.ts
// 저장 순위 스냅샷 이력 조회(GET, 무과금) + 최대 10조합 순위 갱신(POST, 과금).
// 설계 §6.6·§6.7. Labs·직접 SERP 는 source 로 구분(서버가 함께 반환).
'use client';

import { useMutation, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { listRankings, refreshRankings, type ListRankingsParams, type RefreshRankingsBody } from '../api';
import { invalidateSeoDomain } from './use-seo-audit';

export function useRankings(params: Omit<ListRankingsParams, 'cursor'>, enabled = true) {
  return useInfiniteQuery({
    queryKey: ['seo', 'rankings', params],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => listRankings({ ...params, cursor: pageParam }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: enabled && !!params.domainId,
  });
}

/** 최대 10조합 순위 갱신 (scope=ranking). 성공·실패 모두 조회 캐시 재검증(해당 도메인만). */
export function useRefreshRankings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RefreshRankingsBody) => refreshRankings(body),
    onSettled: (_data, _err, body) => invalidateSeoDomain(qc, body.domainId),
  });
}
