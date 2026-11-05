// lib/api/content-channel-publish.ts — 원본(블로그) → 채널 자식 콘텐츠 → 발행 클라이언트 흐름 (단일 출처).
// 승인 게이트 모델: 발행 API 는 "그 채널의 콘텐츠"만 받는다(isPublishable channel_mismatch).
// 따라서 블로그 id 를 인스타·페북·카페 발행 API 에 직접 보내지 않고,
//   1) 같은 원본의 같은 채널 자식이 이미 있으면 재사용(중복 변환·비용·중복 게시 방지 — 카페는 생성 시 자동 파생됨)
//   2) 없으면 POST /api/content/[id]/convert 로 자식 생성
//   3) 자식 id 로 발행. 자식이 검토 대기(pending_review)면 서버가 409 not_approved → 'pending_review' 로 안내
// 상태전이·승인·소유권 판정은 전부 서버 책임. 이 파일은 호출 순서와 결과 해석만 한다.

import { convertContent, listContents, publishContent, ContentApiError, type PublishResult } from './content';
import type { PublishChannel, ReviewListItem } from '@/types/content-review';

export type ChannelPublishOutcome =
  | { kind: 'published'; childId: string; result: PublishResult }
  | { kind: 'pending_review'; childId: string }
  | { kind: 'already_published'; childId: string }
  | { kind: 'failed'; childId: string | null; code: string; message: string };

export const CHANNEL_PUBLISH_LABEL: Record<PublishChannel, string> = {
  naver_cafe: '네이버 카페', instagram: '인스타그램', facebook: '페이스북',
};

/** 검토 게이트로 막힌 발행 코드 — 실패가 아니라 '검토 대기' 로 안내한다 */
const REVIEW_BLOCK_CODES = new Set(['not_approved', 'parent_not_approved']);

/** 발행 API 실패 코드 → 안내 (hooks/usePublishContent 와 동일 기준) */
export const PUBLISH_ERROR_TEXT: Record<string, string> = {
  not_approved: '승인되지 않은 콘텐츠입니다. 먼저 승인해 주세요.',
  parent_not_approved: '원본 콘텐츠 승인이 필요합니다.',
  rejected: '반려된 콘텐츠는 발행할 수 없습니다.',
  already_published: '이미 발행된 콘텐츠입니다.',
  publish_in_progress: '이미 발행이 진행 중입니다.',
  channel_error: '채널 연동 오류로 발행하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  plan_limit: '플랜 한도를 초과했습니다.',
  budget_exceeded: '월 예산 한도를 초과했습니다.',
};

export const PENDING_REVIEW_TEXT = '검토 대기 — 콘텐츠 관리에서 승인 후 발행';

export function contentManageHref(id: string): string {
  return `/content/manage?id=${encodeURIComponent(id)}`;
}

function failure(childId: string | null, err: unknown, fallback: string): ChannelPublishOutcome {
  if (err instanceof ContentApiError) {
    return { kind: 'failed', childId, code: err.code, message: PUBLISH_ERROR_TEXT[err.code] ?? err.message };
  }
  return { kind: 'failed', childId, code: 'unknown', message: err instanceof Error && err.message ? err.message : fallback };
}

/** 재사용할 기존 자식 선택 — 발행됨 > 승인(미발행) > 검토 대기 순. 반려만 있으면 새로 변환한다. */
function pickExistingChild(items: ReviewListItem[]): ReviewListItem | null {
  const live = items.filter((c) => c.review_status !== 'rejected');
  return live.find((c) => c.status === 'published')
    ?? live.find((c) => c.review_status === 'approved')
    ?? live.find((c) => c.review_status === 'pending_review')
    ?? null;
}

export async function publishViaChildContent(
  sourceId: string,
  channel: PublishChannel,
  opts?: { cafeTargetIds?: string[] },
): Promise<ChannelPublishOutcome> {
  // 1) 기존 자식 조회
  let childId: string | null = null;
  try {
    const list = await listContents({ parent_content_id: sourceId, channel, per_page: 20 });
    const existing = pickExistingChild(list.items);
    if (existing) {
      if (existing.status === 'published') return { kind: 'already_published', childId: existing.id };
      if (existing.review_status === 'pending_review') return { kind: 'pending_review', childId: existing.id };
      childId = existing.id;
    }
  } catch (err) {
    return failure(null, err, '기존 채널 콘텐츠 조회에 실패했습니다');
  }

  // 2) 없으면 변환
  if (!childId) {
    try {
      const converted = await convertContent(sourceId, channel);
      if (!converted?.id) return { kind: 'failed', childId: null, code: 'convert_no_id', message: '변환은 성공했지만 ID를 받지 못했습니다' };
      childId = converted.id;
    } catch (err) {
      return failure(null, err, '채널 변환에 실패했습니다');
    }
  }

  // 3) 자식 발행
  try {
    const result = await publishContent(channel, childId, opts);
    return { kind: 'published', childId, result };
  } catch (err) {
    if (err instanceof ContentApiError && REVIEW_BLOCK_CODES.has(err.code)) return { kind: 'pending_review', childId };
    if (err instanceof ContentApiError && err.code === 'already_published') return { kind: 'already_published', childId };
    return failure(childId, err, '발행에 실패했습니다');
  }
}

/** 결과 한 줄 안내 (alert·목록 공용) */
export function channelOutcomeText(channel: PublishChannel, o: ChannelPublishOutcome): string {
  const label = CHANNEL_PUBLISH_LABEL[channel];
  switch (o.kind) {
    case 'published': {
      const r = o.result;
      if (r.results) {
        const ok = r.results.filter((x) => !x.error).length;
        return r.partial ? `${label}: 일부 발행 실패 (성공 ${ok}/${r.results.length})` : `${label}: ${ok}곳 발행 완료`;
      }
      return `${label}: 발행 완료`;
    }
    case 'pending_review': return `${label}: ${PENDING_REVIEW_TEXT}`;
    case 'already_published': return `${label}: 이미 발행된 콘텐츠입니다`;
    case 'failed': return `${label}: 발행 실패 — ${o.message}`;
  }
}
