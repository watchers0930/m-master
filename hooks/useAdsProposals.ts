// hooks/useAdsProposals.ts
// 광고 제안 목록(키셋 무한 조회)·생성(Task 12). 생성은 키워드 도구 + LLM(최대 3분) — 버튼은 진행 중 잠근다.
'use client';

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createAdProposal, listAdProposals, type AdsProposalCreateBody, type AdsProposalListQuery } from '@/lib/api/ads';
import { adsQueryKeys } from '@/hooks/adsQueryKeys';

export function useAdsProposals(q: Omit<AdsProposalListQuery, 'cursor'>) {
  return useInfiniteQuery({
    queryKey: adsQueryKeys.proposals(q),
    queryFn: ({ pageParam }) => listAdProposals({ ...q, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    retry: false,
  });
}

export function useCreateAdsProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AdsProposalCreateBody) => createAdProposal(input),
    onSettled: () => qc.invalidateQueries({ queryKey: adsQueryKeys.proposalsAll }),
  });
}
