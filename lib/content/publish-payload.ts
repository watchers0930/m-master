// lib/content/publish-payload.ts — 상세 API publish_preview 조립. 규칙 자체는 lib/publish/payload.ts(실제 발행과 단일 구현).
import type { Channel } from '@/types/db';
import type { PublishPreviewDTO } from '@/types/content-review';
import { planChannelPayload, buildFacebookMessage, buildInstagramCaption, type PayloadSource } from '@/lib/publish/payload';
export { planChannelPayload, buildFacebookMessage, buildInstagramCaption, INSTAGRAM_IMAGE_REQUIRED } from '@/lib/publish/payload';
export type { PayloadSource, ChannelPayloadPlan } from '@/lib/publish/payload';

/** 상세 API publish_preview — 선택 규칙 + 발행기와 같은 텍스트 변환 */
export function buildPublishPreview(channel: Channel, src: PayloadSource): PublishPreviewDTO {
  const plan = planChannelPayload(channel, src);
  if (plan.channel === 'instagram') {
    return { channel: plan.channel, mode: plan.mode, text: buildInstagramCaption(plan.text), images: plan.images, blocked_reason: plan.blockedReason };
  }
  if (plan.channel === 'facebook') return { ...plan, text: buildFacebookMessage(plan.text) };
  // 카페: 본문은 마크다운→HTML 변환(인라인 이미지 없음) + 고정 푸터. 미리보기는 마크다운을 이미지 마커 없이 렌더.
  if (plan.channel === 'naver_cafe') return { ...plan, footer_appended: true };
  return plan;
}
