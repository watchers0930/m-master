import type { Content } from '@prisma/client';
import { VisibilityError } from '@/lib/visibility/http';
import { publishFacebookPost } from './facebook';
import { publishInstagramImage, publishInstagramCarousel } from './instagram';
import { publishNaverCafePost } from './naver-cafe';
import type { Channel } from '@/types/db';
import { planChannelPayload } from './payload';
export type SendResult = { externalId?: string; externalUrl?: string };
export type ChannelPayload = Pick<Content, 'ownerId' | 'topic' | 'textBody' | 'imageUrl' | 'bodyImageUrls' | 'keywords'>;
export async function sendChannel(channel: Channel, content: ChannelPayload, destinationKey: string): Promise<SendResult> {
  const { ownerId } = content;
  // 이미지·본문 선택은 미리보기와 같은 단일 규칙(payload.ts) — 승인 화면 = 실제 발행
  const plan = planChannelPayload(channel, content);
  const text = plan.text;
  if (plan.channel === 'facebook') {
    const result = await publishFacebookPost({ ownerId, imageUrl: plan.images[0] ?? null, message: text });
    const id = result.postId || result.id;
    return { externalId: id, externalUrl: `https://www.facebook.com/${id}` };
  }
  if (plan.channel === 'instagram') {
    if (plan.mode === 'blocked') throw new VisibilityError('bad_request', plan.blockedReason ?? '발행 이미지가 필요합니다.', 400);
    if (plan.mode === 'carousel') {
      const result = await publishInstagramCarousel({ ownerId, caption: text, imageUrls: plan.images });
      return { externalId: result.id };
    }
    const result = await publishInstagramImage({ ownerId, imageUrl: plan.images[0], caption: text });
    return { externalId: result.id, externalUrl: result.permalink ?? undefined };
  }
  if (plan.channel === 'naver_cafe') {
    const imageUrl = content.imageUrl || content.bodyImageUrls.find(Boolean);
    // destinationKey = claim 에 고정된 정규 목적지('cafe:<clubId>:<menuId>' 또는 'default'=자격증명 기본 게시판)
    const fixed = /^cafe:([^:]+):([^:]+)$/.exec(destinationKey);
    if (destinationKey !== 'default' && !fixed) throw new VisibilityError('bad_request', '알 수 없는 카페 목적지입니다.', 400);
    const target = fixed ? { clubId: fixed[1], menuId: fixed[2] } : null;
    const result = await publishNaverCafePost({ ownerId, subject: content.topic, content: text, keywords: content.keywords,
      imageUrl, imageUrls: content.bodyImageUrls.filter(Boolean), ...(target ?? {}) });
    return { externalId: result.articleId, externalUrl: result.cafeUrl };
  }
  throw new VisibilityError('channel_error', '지원하지 않는 발행 채널입니다.', 502);
}
