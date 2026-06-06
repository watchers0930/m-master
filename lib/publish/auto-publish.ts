// lib/publish/auto-publish.ts — 블로그 생성 후 인스타/페북 자동 발행 오케스트레이터

import { prisma } from '@/lib/prisma';
import { convertBlogToChannel, type ConvertChannel } from '@/lib/claude/convert';
import { publishInstagramImage, publishInstagramCarousel } from './instagram';
import { publishFacebookPost } from './facebook';
import { publishNaverCafePost } from './naver-cafe';
import { trackCost } from '@/lib/cost/tracker';
import { logAudit, AUDIT_ACTIONS } from '@/lib/audit/logger';
import { getNaverCafeCreds, getInstagramCreds, getFacebookCreds, getCafeTargets } from '@/lib/channel-credentials';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface AutoPublishEvent {
  type: 'auto_publish';
  channel?: 'instagram' | 'facebook' | 'naver_cafe';
  status: 'converting' | 'publishing' | 'success' | 'failed' | 'completed';
  url?: string;
  error?: string;
}

interface AutoPublishParams {
  blogContentId: string;
  ownerId: string;
  blogText: string;
  topic: string;
  keywords?: string[];
  imageUrl: string | null;
  bodyImageUrls: string[];
  blogScores: Record<string, number> | null;
  onProgress: (event: AutoPublishEvent) => void;
}

// ---------------------------------------------------------------------------
// DB 자격증명 + 환경변수 모두 확인하여 활성 채널 판별
// ---------------------------------------------------------------------------
async function getActiveChannels(): Promise<ConvertChannel[]> {
  const channels: ConvertChannel[] = [];
  // 현재 카페만 활성 (페이스북·인스타는 토큰 재발급 후 복원)
  const naverCreds = await getNaverCafeCreds();
  if (naverCreds) channels.push('naver_cafe');
  return channels;
}

// ---------------------------------------------------------------------------
// 채널별 발행 처리
// ---------------------------------------------------------------------------
async function publishToChannel(
  channel: ConvertChannel,
  params: AutoPublishParams,
): Promise<void> {
  const { blogContentId, ownerId, blogText, topic, imageUrl, onProgress } = params;

  // 1) 변환
  onProgress({ type: 'auto_publish', channel, status: 'converting' });
  const converted = await convertBlogToChannel(blogText, topic, channel);

  // 2) Content row 생성 (draft)
  const content = await prisma.content.create({
    data: {
      ownerId,
      channel,
      topic,
      tone: null,
      keywords: [],
      textBody: converted.text,
      imageUrl,
      bodyImageUrls: params.bodyImageUrls ?? [],
      scores: params.blogScores ?? {},
      costKrw: converted.krw,
      status: 'draft',
    },
    select: { id: true },
  });

  // 3) 변환 비용 기록
  await trackCost({
    kind: 'chat',
    tokensIn: converted.usage.prompt_tokens,
    tokensOut: converted.usage.completion_tokens,
    krw: converted.krw,
    contentId: content.id,
  });

  // 4) 발행
  onProgress({ type: 'auto_publish', channel, status: 'publishing' });

  let externalId: string | undefined;
  let externalUrl: string | undefined;
  let firstTargetName: string | undefined;
  if (channel === 'instagram') {
    // bodyImageUrls가 2장 이상이면 캐러셀 발행
    if (params.bodyImageUrls.length >= 2) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
      const absoluteUrls = params.bodyImageUrls.map(u => u.startsWith('http') ? u : `${appUrl}${u}`);
      const result = await publishInstagramCarousel({
        imageUrls: absoluteUrls,
        caption: converted.text,
      });
      externalId = result.id;
    } else {
      if (!imageUrl) throw new Error('Instagram 단일 이미지 발행에 이미지 URL 필수');
      const result = await publishInstagramImage({
        imageUrl,
        caption: converted.text,
      });
      externalId = result.id;
      externalUrl = result.permalink ?? undefined;
    }
  } else if (channel === 'facebook') {
    const result = await publishFacebookPost({
      imageUrl,
      message: converted.text,
    });
    externalId = result.id;
    externalUrl = `https://facebook.com/${result.id}`;
  } else if (channel === 'naver_cafe') {
    // 다중 카페 타겟 지원: 모든 타겟에 순차 발행
    const cafeTargets = await getCafeTargets();
    if (cafeTargets.length > 0) {
      const errors: string[] = [];
      for (let t = 0; t < cafeTargets.length; t++) {
        const target = cafeTargets[t];
        // 두 번째 카페부터 10초 대기 (스팸 필터 방지)
        if (t > 0) await new Promise(r => setTimeout(r, 10_000));
        try {
          const result = await publishNaverCafePost({
            subject: topic,
            content: converted.text,
            keywords: params.keywords,
            imageUrls: params.bodyImageUrls,
            imageUrl: imageUrl ?? undefined,
            clubId: target.clubId,
            menuId: target.menuId,
          });
          console.log(`[auto-publish] naver_cafe ${target.name} 성공: ${result.cafeUrl}`);
          // 첫 번째 성공 타겟 결과를 대표값으로 사용
          if (!externalId) {
            externalId = result.articleId;
            externalUrl = result.cafeUrl;
            firstTargetName = target.name;
          } else {
            // 추가 타겟은 별도 ScheduleSlot 생성
            await prisma.scheduleSlot.create({
              data: {
                contentId: content.id, channel: 'naver_cafe',
                scheduledAt: new Date(), publishedAt: new Date(),
                status: 'published', mode: 'ai_auto',
                targetName: target.name,
                externalId: result.articleId, externalUrl: result.cafeUrl,
              },
            });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[auto-publish] naver_cafe ${target.name} 실패:`, msg);
          errors.push(`${target.name}: ${msg}`);
        }
      }
      // 모든 타겟이 실패하면 에러 throw
      if (!externalId && errors.length > 0) {
        throw new Error(`네이버 카페 전체 발행 실패 — ${errors.join(' | ')}`);
      }
    } else {
      // CafeTarget 없으면 기존 방식 (credential의 clubId/menuId)
      const result = await publishNaverCafePost({
        subject: topic,
        content: converted.text,
        keywords: params.keywords,
        imageUrls: params.bodyImageUrls,
        imageUrl: imageUrl ?? undefined,
      });
      externalId = result.articleId;
      externalUrl = result.cafeUrl;
    }
  }

  // 5) Content status → published
  await prisma.content.update({
    where: { id: content.id },
    data: { status: 'published' },
  });

  // 6) ScheduleSlot 생성 (mode: ai_auto)
  await prisma.scheduleSlot.create({
    data: {
      contentId: content.id,
      channel,
      scheduledAt: new Date(),
      publishedAt: new Date(),
      status: 'published',
      mode: 'ai_auto',
      targetName: firstTargetName ?? null,
      externalId: externalId ?? null,
      externalUrl: externalUrl ?? null,
    },
  });

  // 7) audit log
  await logAudit({
    actor: ownerId,
    action: channel === 'instagram' ? AUDIT_ACTIONS.PUBLISH_INSTAGRAM
      : channel === 'facebook' ? AUDIT_ACTIONS.PUBLISH_FACEBOOK
      : AUDIT_ACTIONS.PUBLISH_NAVER_CAFE,
    targetType: 'content',
    targetId: content.id,
    payload: {
      source_blog_id: blogContentId,
      external_id: externalId,
      cost_krw: converted.krw,
    },
  });

  onProgress({ type: 'auto_publish', channel, status: 'success' });
}

// ---------------------------------------------------------------------------
// 메인 오케스트레이터
// ---------------------------------------------------------------------------
export async function autoPublishToSocial(params: AutoPublishParams): Promise<void> {
  const channels = await getActiveChannels();
  if (channels.length === 0) return; // 활성 채널 없으면 스킵

  // 3채널 병렬 실행 — Vercel Hobby 60초 제한 대응
  const results = await Promise.allSettled(
    channels.map((channel) => publishToChannel(channel, params)),
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'rejected') {
      const err = result.reason;
      console.error(`[auto-publish] ${channels[i]} 실패:`, err);
      params.onProgress({
        type: 'auto_publish',
        channel: channels[i],
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  params.onProgress({ type: 'auto_publish', status: 'completed' });
}
