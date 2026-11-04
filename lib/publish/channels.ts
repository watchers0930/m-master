import type { Content } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { notFound, VisibilityError } from '@/lib/visibility/http';
import { publishFacebookPost } from './facebook';
import { publishInstagramImage, publishInstagramCarousel } from './instagram';
import { publishNaverCafePost } from './naver-cafe';
import type { Channel } from '@/types/db';
export type SendResult = { externalId?: string; externalUrl?: string };
export type ChannelPayload = Pick<Content, 'ownerId' | 'topic' | 'textBody' | 'imageUrl' | 'bodyImageUrls' | 'keywords'>;
export async function sendChannel(channel: Channel, content: ChannelPayload, destinationKey: string): Promise<SendResult> {
  const { ownerId } = content;
  const text = content.textBody || content.topic;
  const imageUrl = content.imageUrl || content.bodyImageUrls.find(Boolean);
  if (channel === 'facebook') {
    const result = await publishFacebookPost({ ownerId, imageUrl: imageUrl ?? null, message: text });
    const id = result.postId || result.id;
    return { externalId: id, externalUrl: `https://www.facebook.com/${id}` };
  }
  if (channel === 'instagram') {
    if (!imageUrl) throw new VisibilityError('bad_request', '발행 이미지가 필요합니다.', 400);
    if (content.bodyImageUrls.filter(Boolean).length >= 2) {
      const result = await publishInstagramCarousel({ ownerId, caption: text, imageUrls: content.bodyImageUrls.filter(Boolean) });
      return { externalId: result.id };
    }
    const result = await publishInstagramImage({ ownerId, imageUrl, caption: text });
    return { externalId: result.id, externalUrl: result.permalink ?? undefined };
  }
  if (channel === 'naver_cafe') {
    const target = destinationKey === 'default' ? null : await prisma.cafeTarget.findFirst({
      where: { id: destinationKey, ownerId }, select: { clubId: true, menuId: true } });
    if (destinationKey !== 'default' && !target) notFound();
    const result = await publishNaverCafePost({ ownerId, subject: content.topic, content: text, keywords: content.keywords,
      imageUrl, imageUrls: content.bodyImageUrls.filter(Boolean), ...(target ?? {}) });
    return { externalId: result.articleId, externalUrl: result.cafeUrl };
  }
  throw new VisibilityError('channel_error', '지원하지 않는 발행 채널입니다.', 502);
}
