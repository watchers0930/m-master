// app/(dashboard)/seo-audit/hooks/use-seo-keywords.ts
// 저장 키워드·수요·기회 조회(GET, 무과금) + bounded 리서치 실행(POST, 과금).
// 설계 §6.4·§6.5. 조회는 필터 범위 일괄(keyset) — 키워드마다 별도 최신 Ranking 조회 금지.
'use client';

import { useMutation, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { listKeywords, researchKeywords, type ListKeywordsParams, type ResearchKeywordsBody } from '../api';
import { invalidateSeoDomain } from './use-seo-audit';

export function useKeywords(params: Omit<ListKeywordsParams, 'cursor'>, enabled = true) {
  return useInfiniteQuery({
    queryKey: ['seo', 'keywords', params],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => listKeywords({ ...params, cursor: pageParam }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: enabled && !!params.domainId,
  });
}

/**
 * 리서치·볼륨 갱신 (scope=research). 성공·실패 모두 조회 캐시 재검증(해당 도메인만).
 * scope=research 는 Labs 순위도 저장할 수 있으므로 rankings 도 함께 무효화한다(리뷰 지적 8).
 */
export function useResearchKeywords() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ResearchKeywordsBody) => researchKeywords(body),
    onSettled: (_data, _err, body) => invalidateSeoDomain(qc, body.domainId),
  });
}
