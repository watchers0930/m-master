// hooks/useContentEdit.ts
// 콘텐츠 수정 mutation (PATCH /api/content/[id], 설계 §4.2).
// 바뀐 필드만 보낸다(strict 스키마 — 허용 외 필드 금지). 검토 리셋 여부는 서버가 결정한다.
'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateContent, ContentApiError } from '@/lib/api/content';
import type { ContentDetail, ContentPatchBody } from '@/types/content-review';
import { contentKeys, refreshContent } from './useContentDetail';
import type { ReviewNotice } from './useContentReview';

export interface ContentDraft {
  topic: string;
  text_body: string;
  keywords: string[];
}

const CONFLICT_TEXT: Record<string, string> = {
  version_conflict: '다른 곳에서 변경되었습니다. 최신 내용을 불러왔습니다. 다시 수정해 주세요.',
  publish_in_progress: '발행이 진행 중이라 지금은 수정할 수 없습니다.',
  already_published: '이미 발행된 콘텐츠는 수정할 수 없습니다.',
};

/** 원본과 비교해 바뀐 필드만 추린다. 바뀐 게 없으면 null */
export function diffDraft(orig: ContentDetail, d: ContentDraft): Omit<ContentPatchBody, 'expected_updated_at'> | null {
  const out: Omit<ContentPatchBody, 'expected_updated_at'> = {};
  if (d.topic !== orig.topic) out.topic = d.topic;
  if (d.text_body !== (orig.text_body ?? '')) out.text_body = d.text_body;
  const before = orig.keywords ?? [];
  if (d.keywords.length !== before.length || d.keywords.some((k, i) => k !== before[i])) out.keywords = d.keywords;
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * base = 편집을 시작한 시점의 콘텐츠 스냅샷. 백그라운드 재조회로 최신 updated_at 이 들어와도
 * expected_updated_at 은 초안이 기반한 버전(base)으로 보내야 서버 CAS 가 남의 변경 덮어쓰기를 막는다.
 * onResult: 저장 성공·409 충돌을 부모에 전달(성공 → 폼 닫힘, 충돌 → 최신본으로 폼 재시작).
 * mutate 단위 콜백이라 폼이 언마운트(다른 글 선택)되면 호출되지 않는다 — 안내가 다른 글에 붙지 않음.
 */
export function useContentEdit(
  base: ContentDetail,
  onResult?: (notice: ReviewNotice, kind: 'saved' | 'conflict') => void,
) {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<ReviewNotice | null>(null);

  const m = useMutation({
    mutationFn: (body: ContentPatchBody) => updateContent(base.id, body),
    onMutate: () => setNotice(null),
    onSuccess: async (updated) => {
      qc.setQueryData(contentKeys.detail(updated.id), updated);
      await qc.invalidateQueries({ queryKey: contentKeys.listRoot });
    },
    onError: async (err) => {
      if (err instanceof ContentApiError && err.status === 409) {
        setNotice({ tone: 'warn', text: CONFLICT_TEXT[err.code] ?? err.message });
        await refreshContent(qc, base.id);
        return;
      }
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : '저장에 실패했습니다.' });
    },
  });

  /** false = 보낼 변경 없음(요청 안 함) */
  const save = (draft: ContentDraft): boolean => {
    if (m.isPending) return false;
    const changes = diffDraft(base, draft);
    if (!changes) {
      setNotice({ tone: 'warn', text: '변경된 내용이 없습니다.' });
      return false;
    }
    m.mutate({ expected_updated_at: base.updated_at, ...changes }, {
      onSuccess: (updated) => {
        const reset = base.review_status === 'approved' && updated.review_status === 'pending_review';
        onResult?.({ tone: 'ok', text: reset ? '저장했습니다. 내용이 바뀌어 다시 검토 대기로 전환되었습니다.' : '저장했습니다.' }, 'saved');
      },
      onError: (err) => {
        if (err instanceof ContentApiError && err.status === 409) {
          onResult?.({ tone: 'warn', text: CONFLICT_TEXT[err.code] ?? err.message }, 'conflict');
        }
      },
    });
    return true;
  };

  return { save, pending: m.isPending, notice };
}
