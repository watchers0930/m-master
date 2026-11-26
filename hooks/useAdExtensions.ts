// hooks/useAdExtensions.ts — 광고그룹 확장소재(3.6단계): 현황 조회(네이버 목록 1회 — 펼쳤을 때만)·AI 초안·등록.
// 등록은 성공·실패 모두 현황을 다시 읽는다(일부 유형만 만들어졌을 수 있다).
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { applyGroupExtensions, draftGroupExtensions, getGroupExtensions, releaseGroupExtension } from '@/lib/api/ads';
import { adsQueryKeys } from '@/hooks/adsQueryKeys';
import type { AdExtensionDraftBody } from '@/types/ads';

export function useGroupExtensions(groupId: string, enabled: boolean) {
  return useQuery({ queryKey: adsQueryKeys.extensions(groupId), queryFn: () => getGroupExtensions(groupId), enabled, retry: false });
}

export function useDraftExtensions(groupId: string) {
  return useMutation({ mutationFn: () => draftGroupExtensions(groupId) });
}

export function useApplyExtensions(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AdExtensionDraftBody) => applyGroupExtensions(groupId, body),
    onSettled: () => qc.invalidateQueries({ queryKey: adsQueryKeys.extensions(groupId) }),
  });
}

/** 10분 넘게 끝나지 않은 등록 풀기(서버가 네이버 목록을 다시 확인한다). */
export function useReleaseExtension(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (type: string) => releaseGroupExtension(groupId, type),
    onSettled: () => qc.invalidateQueries({ queryKey: adsQueryKeys.extensions(groupId) }),
  });
}
