// types/content-review.ts
// 콘텐츠 검토·수정·발행 화면 DTO (설계 §4.1~§4.4·§5.7).
// 엔티티·목록 타입의 단일 출처는 공용 계약 types/db.ts·types/api.ts(백엔드 소유) — 여기서는 재노출만 하고,
// 공용 파일에 없는 화면 전용 요청·응답 형태만 선언한다(중복 정의 금지). 타입 전용.

import type { Content, Channel, ContentStatus, ContentOrigin, ReviewStatus } from '@/types/db';
import type { ContentListItem, ContentListResponse } from '@/types/api';

export type { ContentOrigin, ReviewStatus };
export type ReviewDecision = 'approve' | 'reject' | 'request_review';

/** GET /api/content 목록 행 (설계 §4.1) */
export type ReviewListItem = ContentListItem;
export type ReviewListResponse = ContentListResponse;

export interface ReviewListQuery {
  status?: ContentStatus;
  channel?: Channel;
  review_status?: ReviewStatus;
  origin?: ContentOrigin;
  page?: number;
  per_page?: number;
}

/** 전략 근거 스냅샷 (설계 §3.5 StrategyContext → 응답 snake_case) */
export type StrategyContextDTO = NonNullable<Content['strategy_context']>;

/** isPublishable 차단 사유 (설계 §5.7) */
export type PublishBlockReason =
  | 'owner_mismatch' | 'channel_mismatch' | 'not_approved' | 'rejected'
  | 'parent_not_approved' | 'already_published' | 'claim_held' | 'version_mismatch'
  | 'not_due' | 'job_not_pending';

/** 서버 isPublishable 결과 — 표시용. 실제 차단은 발행 API (설계 §4.1) */
export interface PublishStateDTO {
  allowed: boolean;
  reason?: PublishBlockReason | null;
  active_claim: boolean;
}

/** GET /api/content/[id] (설계 §4.1) — 기존 전체 필드(검토·전략 포함) + 발행 판정 */
export interface ContentDetail extends Content {
  publish: PublishStateDTO;
  /** 채널 발행기가 실제로 보낼 페이로드 (lib/content/publish-payload.ts — 미리보기 = 발행 내용) */
  publish_preview: PublishPreviewDTO;
}

/**
 * 채널별 실제 발행 페이로드 (설계: 검토자는 발행될 내용 그대로 본다).
 * text = 발행기 변환(캡션·메시지) 적용 후 문자열. blog 는 작업자가 [이미지] 마커 위치에 본문 이미지를 배치.
 */
export type PublishPreviewDTO =
  | { channel: 'blog'; text: string; images: string[] }
  | { channel: 'instagram'; mode: 'carousel' | 'single' | 'blocked'; text: string; images: string[]; blocked_reason: string | null }
  | { channel: 'facebook'; mode: 'photo' | 'text'; text: string; images: string[] }
  | { channel: 'naver_cafe'; subject: string; text: string; images: string[]; footer_appended: true };

/** PATCH /api/content/[id] 요청 (설계 §4.2) — strict, 수정 필드 최소 1개 */
export interface ContentPatchBody {
  expected_updated_at: string;
  topic?: string;
  text_body?: string;
  keywords?: string[];
}

/** POST /api/content/[id]/review 요청·응답 (설계 §4.3) */
export interface ReviewBody {
  decision: ReviewDecision;
  expected_updated_at: string;
  reason?: string;
}

export interface ReviewResult {
  id: string;
  review_status: ReviewStatus;
  reviewed_at: string | null;
  updated_at: string;
  changed: boolean;
}

/** 수동 발행 채널 (설계 §4.4) */
export type PublishChannel = 'naver_cafe' | 'facebook' | 'instagram';
export type ConvertChannel = 'instagram' | 'facebook';
