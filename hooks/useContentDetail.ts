// hooks/useContentDetail.ts
// 콘텐츠 상세 조회 + 콘텐츠 관리 화면 쿼리키 단일 출처.
// 검토·수정·발행 훅이 같은 키로 무효화해야 목록·상세가 어긋나지 않는다.
'use client';

import { useQuery, type QueryClient } from '@tanstack/react-query';
import { getContentDetail } from '@/app/(dashboard)/content/manage/api';
import type { ContentDetail } from '@/app/(dashboard)/content/manage/types';

export const contentKeys = {
  listRoot: ['contents', 'list'] as const,
  detail: (id: string | null) => ['content', 'detail', id] as const,
};

/** 상세·목록을 함께 재조회 (409 충돌·상태전이 직후 서버 최신값으로 맞춘다) */
export function refreshContent(qc: QueryClient, id: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: contentKeys.detail(id) }),
    qc.invalidateQueries({ queryKey: contentKeys.listRoot }),
  ]);
}

export function useContentDetail(contentId: string | null) {
  return useQuery<ContentDetail>({
    queryKey: contentKeys.detail(contentId),
    enabled: !!contentId,
    queryFn: () => getContentDetail(contentId!),
  });
}
