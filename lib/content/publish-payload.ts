// lib/content/publish-payload.ts
// 채널별 발행 페이로드 선택 규칙(순수 함수) — lib/publish/channels.ts sendChannel 과 동일 규칙.
// 미리보기(상세 API publish_preview)가 이 함수를 쓰고, 동등성은 __tests__/publish-payload*.test.cjs 가
// sendChannel 실제 호출 인자·실제 캡션 변환 함수 결과와 비교해 고정한다(규칙이 어긋나면 테스트 실패).
// 채널 어댑터(lib/publish/{instagram,facebook,naver-cafe}) import 는 channels.ts 만 허용(경계 가드) — 그래서
// 캡션 변환은 여기 복제하고 테스트로 동등성을 강제한다.
import type { Channel } from '@/types/db';
import type { PublishPreviewDTO } from '@/types/content-review';

export interface PayloadSource {
  topic: string;
  textBody: string | null;
  imageUrl: string | null;
  bodyImageUrls: string[];
}

export type ChannelPayloadPlan =
  | { channel: 'blog'; text: string; images: string[] }
  | { channel: 'instagram'; mode: 'carousel' | 'single' | 'blocked'; text: string; images: string[]; blockedReason: string | null }
  | { channel: 'facebook'; mode: 'photo' | 'text'; text: string; images: string[] }
  | { channel: 'naver_cafe'; subject: string; text: string; images: string[] };

export const INSTAGRAM_IMAGE_REQUIRED = '발행 이미지가 필요합니다.';

/** 발행기 변환(캡션 정리 등) 적용 전의 원문·이미지 선택 */
export function planChannelPayload(channel: Channel, src: PayloadSource): ChannelPayloadPlan {
  const text = src.textBody || src.topic;
  const bodyImages = src.bodyImageUrls.filter(Boolean);
  const imageUrl = src.imageUrl || src.bodyImageUrls.find(Boolean) || null;
  if (channel === 'instagram') {
    if (!imageUrl) return { channel, mode: 'blocked', text, images: [], blockedReason: INSTAGRAM_IMAGE_REQUIRED };
    if (bodyImages.length >= 2) return { channel, mode: 'carousel', text, images: bodyImages, blockedReason: null };
    return { channel, mode: 'single', text, images: [imageUrl], blockedReason: null };
  }
  if (channel === 'facebook') {
    return imageUrl ? { channel, mode: 'photo', text, images: [imageUrl] } : { channel, mode: 'text', text, images: [] };
  }
  if (channel === 'naver_cafe') {
    // publishNaverCafePost: 본문 이미지 우선, 없으면 대표 이미지 폴백 → 대표 1장만 첨부(본문 인라인 이미지 없음)
    const cafeImages = bodyImages.filter(u => u.trim() !== '');
    const attach = cafeImages.length > 0 ? cafeImages[0] : imageUrl;
    return { channel, subject: src.topic, text, images: attach ? [attach] : [] };
  }
  // blog: 작업자가 본문 [이미지] 마커 순서대로 본문 이미지를 배치
  return { channel: 'blog', text: src.textBody ?? '', images: src.bodyImageUrls };
}

const IG_CAPTION_MAX = 2200;

/** lib/publish/facebook.ts buildFacebookMessage 와 동일 (테스트로 동등성 고정) */
export function previewFacebookMessage(markdown: string): string {
  return markdown
    .replace(/^\[이미지:.*\]$/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^>\s+/gm, '')
    .replace(/^-\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** lib/publish/instagram.ts buildInstagramCaption 과 동일 (테스트로 동등성 고정) */
export function previewInstagramCaption(markdown: string): string {
  const text = previewFacebookMessage(markdown);
  return text.length > IG_CAPTION_MAX ? text.slice(0, IG_CAPTION_MAX - 1).trimEnd() + '…' : text;
}

/** 상세 API publish_preview — 선택 규칙 + 발행기와 같은 텍스트 변환 */
export function buildPublishPreview(channel: Channel, src: PayloadSource): PublishPreviewDTO {
  const plan = planChannelPayload(channel, src);
  if (plan.channel === 'instagram') {
    return { channel: plan.channel, mode: plan.mode, text: previewInstagramCaption(plan.text), images: plan.images, blocked_reason: plan.blockedReason };
  }
  if (plan.channel === 'facebook') return { ...plan, text: previewFacebookMessage(plan.text) };
  // 카페: 본문은 마크다운→HTML 변환(인라인 이미지 없음) + 고정 푸터. 미리보기는 마크다운을 이미지 마커 없이 렌더.
  if (plan.channel === 'naver_cafe') return { ...plan, footer_appended: true };
  return plan;
}
