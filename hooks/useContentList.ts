// hooks/useContentList.ts
// 콘텐츠 관리 목록 조회 (GET /api/content, 설계 §4.1). 필터·페이지별 캐시.
// 쿼리키는 contentKeys.listRoot 하위 — 검토·수정·발행·변환 훅의 무효화 대상에 자동 포함된다.
'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { listContents } from '@/lib/api/content';
import type { ContentStatus } from '@/types/db';
import type { ReviewStatus } from '@/types/content-review';
import { contentKeys } from './useContentDetail';

export const CONTENT_PAGE_SIZE = 50;

export function useContentList(status: ContentStatus | '', reviewStatus: ReviewStatus | '', page: number) {
  return useQuery({
    queryKey: [...contentKeys.listRoot, status || 'all', reviewStatus || 'all', page],
    queryFn: () => listContents({
      status: status || undefined,
      review_status: reviewStatus || undefined,
      page,
      per_page: CONTENT_PAGE_SIZE,
    }),
    // 페이지 이동 중 이전 페이지를 유지해 목록이 깜빡이지 않게 한다
    placeholderData: keepPreviousData,
  });
}
