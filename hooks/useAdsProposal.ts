// hooks/useAdsProposal.ts
// 광고 제안 상세·편집·승인/반려·적용(Task 12). 편집·결정은 expected_updated_at(CAS)을 보낸다.
// 409 version_conflict면 최신을 다시 읽는다(화면은 errorView의 reload로 안내). 적용 뒤에는 제안·개요를 다시 읽는다.
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AdsApiError, applyAdProposal, editAdProposal, getAdProposal, getAdProposalEstimate, reviewAdProposal } from '@/lib/api/ads';
import { adsQueryKeys } from '@/hooks/adsQueryKeys';
import type { ProposalPayload } from '@/types/ads';

export function useAdsProposal(id: string) {
  return useQuery({ queryKey: adsQueryKeys.proposal(id), queryFn: () => getAdProposal(id), retry: false });
}

export function useAdsProposalActions(id: string, accountId: string | null) {
  const qc = useQueryClient();
  const reload = () => qc.invalidateQueries({ queryKey: adsQueryKeys.proposal(id) });
  const onError = (error: unknown) => {
    if (error instanceof AdsApiError && error.code === 'version_conflict') void reload();
  };
  const listChanged = () => qc.invalidateQueries({ queryKey: adsQueryKeys.proposalsAll });
  const edit = useMutation({
    mutationFn: (v: { expectedUpdatedAt: string; payload: ProposalPayload }) => editAdProposal(id, v.expectedUpdatedAt, v.payload),
    onSuccess: (dto) => qc.setQueryData(adsQueryKeys.proposal(id), dto),
    onError,
  });
  const review = useMutation({
    mutationFn: (v: { decision: 'approve' | 'reject'; expectedUpdatedAt: string; reason?: string }) =>
      reviewAdProposal(id, v.decision, v.expectedUpdatedAt, v.reason),
    onSuccess: (dto) => { qc.setQueryData(adsQueryKeys.proposal(id), dto); void listChanged(); },
    onError,
  });
  const apply = useMutation({
    mutationFn: () => applyAdProposal(id),
    onSettled: () => {
      void reload();
      void listChanged();
      if (accountId) void qc.invalidateQueries({ queryKey: adsQueryKeys.overview(accountId) });
    },
  });
  return { edit, review, apply };
}

/** 순위별 예상 입찰가(B4): 버튼을 눌렀을 때만 부른다(페이지 로드·포커스·재시도 없음 — 네이버 호출 한도 보호, 서버도 1분에 1번). */
export function useAdsProposalEstimate(id: string) {
  return useMutation({ mutationFn: () => getAdProposalEstimate(id), retry: false });
}
