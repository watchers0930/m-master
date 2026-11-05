// lib/publish/payload.ts — 채널 발행 페이로드 규칙(순수 함수) 단일 구현.
// 실제 발행(channels.ts·facebook/instagram 어댑터)과 검토 미리보기(lib/content/publish-payload.ts)가 같이 쓴다
// → 승인 화면에 보이는 것 = 실제로 나가는 것. 외부 호출·자격증명 없음(경계 가드상 어댑터가 아니므로 import 허용).
import type { Channel } from '@/types/db';

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

/** 페이스북 메시지(캡션 제한이 IG보다 훨씬 큼, 실질 63206자) — 마크다운 정리만 */
export function buildFacebookMessage(markdown: string): string {
  return markdown
    .replace(/^\[이미지:.*\]$/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^>\s+/gm, '')
    .replace(/^-\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** IG 캡션: 마크다운·[이미지] 마커 제거 + 2200자 제한(말줄임표) */
export function buildInstagramCaption(markdown: string): string {
  const text = buildFacebookMessage(markdown);
  return text.length > IG_CAPTION_MAX ? text.slice(0, IG_CAPTION_MAX - 1).trimEnd() + '…' : text;
}
