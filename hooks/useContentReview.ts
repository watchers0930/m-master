// hooks/useContentReview.ts
// 검토 상태전이 mutation (POST /api/content/[id]/review, 설계 §4.3).
// 서버 규칙(전이 가능 여부·CAS·claim 충돌)은 판단하지 않는다 — 응답 코드로만 안내한다.
// 409 → 상세·목록 재조회 + 안내, 자동 재시도 없음(설계 §6 UX 규칙).
'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { reviewContent, ContentApiError } from '@/lib/api/content';
import type { ReviewDecision, ReviewResult } from '@/types/content-review';
import { refreshContent } from './useContentDetail';

export type ReviewNotice = { tone: 'ok' | 'warn' | 'error'; text: string };

const CONFLICT_TEXT: Record<string, string> = {
  version_conflict: '다른 곳에서 변경되었습니다. 최신 내용을 불러왔습니다.',
  invalid_transition: '현재 상태에서는 할 수 없는 작업입니다. 최신 상태를 불러왔습니다.',
  publish_in_progress: '발행이 진행 중이라 지금은 변경할 수 없습니다.',
};

function successText(decision: ReviewDecision, r: ReviewResult): string {
  if (!r.changed) return '이미 반영된 상태입니다.';
  if (decision === 'approve') return '승인되었습니다. 다음 발행 주기에 게시됩니다.';
  if (decision === 'reject') return '반려되었습니다.';
  return '검토 대기로 되돌렸습니다.';
}

export function useContentReview(contentId: string | null) {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<ReviewNotice | null>(null);

  const m = useMutation({
    mutationFn: (v: { decision: ReviewDecision; expectedUpdatedAt: string; reason?: string }) =>
      reviewContent(contentId!, {
        decision: v.decision,
        expected_updated_at: v.expectedUpdatedAt,
        ...(v.reason ? { reason: v.reason } : {}),
      }),
    onMutate: () => setNotice(null),
    onSuccess: async (r, v) => {
      setNotice({ tone: 'ok', text: successText(v.decision, r) });
      if (contentId) await refreshContent(qc, contentId);
    },
    onError: async (err) => {
      if (err instanceof ContentApiError && err.status === 409) {
        setNotice({ tone: 'warn', text: CONFLICT_TEXT[err.code] ?? err.message });
        if (contentId) await refreshContent(qc, contentId);
        return;
      }
      if (err instanceof ContentApiError && err.status === 404) {
        setNotice({ tone: 'error', text: '콘텐츠를 찾을 수 없습니다.' });
        return;
      }
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : '검토 처리에 실패했습니다.' });
    },
  });

  /** onDone 은 서버 성공 응답 후에만 호출 — 실패 시 입력(반려 사유)을 보존한다 */
  const submit = (decision: ReviewDecision, expectedUpdatedAt: string, reason?: string, onDone?: () => void) => {
    if (!contentId || m.isPending) return; // 중복 클릭 방지
    m.mutate({ decision, expectedUpdatedAt, reason: reason?.trim() || undefined }, { onSuccess: () => onDone?.() });
  };

  return { submit, pending: m.isPending, notice };
}
