// app/(dashboard)/visibility/hooks/use-visibility-queries.ts
// 질문 CRUD + 즉시 캡처 패칭·상태 (react-query). 성공 시 관련 쿼리 무효화.
'use client';

import { useMutation, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  listVisibilityQueries,
  createVisibilityQuery,
  updateVisibilityQuery,
  deleteVisibilityQuery,
  captureSnapshot,
  type ListQueriesParams,
  type CreateQueryBody,
  type UpdateQueryBody,
} from '../api';
import type { EngineId } from '@/types/visibility';

export function useVisibilityQueries(params: ListQueriesParams = {}, enabled = true) {
  return useInfiniteQuery({
    queryKey: ['visibility', 'queries', params],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => listVisibilityQueries({ ...params, cursor: pageParam }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });
}

/**
 * 질문 변경 후 질문 목록·집계만 갱신한다.
 * 도메인 목록(['visibility','domains'])은 이 작업으로 바뀌지 않으므로 무효화하지 않는다(LOW9).
 * 도메인은 생성 성공 시 use-domains 에서만 자체 무효화한다.
 */
function useInvalidateVisibility() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['visibility', 'queries'] });
    qc.invalidateQueries({ queryKey: ['visibility', 'data'] });
  };
}

export function useCreateQuery() {
  const invalidate = useInvalidateVisibility();
  return useMutation({
    mutationFn: (body: CreateQueryBody) => createVisibilityQuery(body),
    onSuccess: invalidate,
  });
}

export function useUpdateQuery() {
  const invalidate = useInvalidateVisibility();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateQueryBody }) =>
      updateVisibilityQuery(id, body),
    onSuccess: invalidate,
  });
}

export function useDeleteQuery() {
  const invalidate = useInvalidateVisibility();
  return useMutation({
    mutationFn: (id: string) => deleteVisibilityQuery(id),
    onSuccess: invalidate,
  });
}

export function useCaptureSnapshot() {
  const invalidate = useInvalidateVisibility();
  return useMutation({
    mutationFn: ({ queryId, engines }: { queryId: string; engines?: EngineId[] }) =>
      captureSnapshot(queryId, engines),
    // 수집기는 전 엔진 실패(502) 시에도 실패 스냅샷·최근 수집 시각을 DB에 반영하므로,
    // 성공뿐 아니라 실패에도 목록·집계를 재조회한다(onSettled, MED4). POST 자동 재시도는 하지 않는다.
    onSettled: invalidate,
  });
}
