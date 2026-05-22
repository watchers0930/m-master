// app/api/cron/schedule-publish/route.ts — 예약 발행 자동화 cron
// Vercel Cron: */30 * * * * (매 30분)
// ScheduleSlot(scheduledAt <= now, status = 'scheduled', retryCount < 3) 조회 후 순차 발행

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { publishNaverCafePost } from '@/lib/publish/naver-cafe';
import { publishFacebookPost } from '@/lib/publish/facebook';
import { publishInstagramImage, publishInstagramCarousel } from '@/lib/publish/instagram';
import { logAudit, AUDIT_ACTIONS } from '@/lib/audit/logger';

export const maxDuration = 300; // 5분 (Vercel Pro)
export const dynamic = 'force-dynamic';

const MAX_RETRY = 3;

// ---------------------------------------------------------------------------
// CRON_SECRET 인증
// ---------------------------------------------------------------------------
function verifyCronSecret(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${secret}`;
}

// ---------------------------------------------------------------------------
// GET handler (Vercel Cron은 GET으로 호출)
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('[cron/schedule-publish] 실행 시작');

  // 발행 대상 슬롯 조회: 예약 시간 경과 + scheduled 상태 + 재시도 3회 미만 + blog 제외
  const slots = await prisma.scheduleSlot.findMany({
    where: {
      scheduledAt: { lte: new Date() },
      status: 'scheduled',
      retryCount: { lt: MAX_RETRY },
      channel: { not: 'blog' },
    },
    include: {
      content: {
        select: { id: true, textBody: true, imageUrl: true, bodyImageUrls: true, topic: true },
      },
    },
    // 정렬: channel ASC (facebook → instagram → naver_cafe) + scheduledAt ASC
    orderBy: [{ channel: 'asc' }, { scheduledAt: 'asc' }],
  });

  if (slots.length === 0) {
    console.log('[cron/schedule-publish] 발행 대상 없음');
    return NextResponse.json({ ok: true, processed: 0 });
  }

  console.log(`[cron/schedule-publish] ${slots.length}건 처리 시작`);

  const results: Array<{
    slotId: string;
    channel: string;
    status: string;
    error?: string;
  }> = [];

  let prevWasNaverCafe = false;

  for (const slot of slots) {
    const content = slot.content;

    // naver_cafe 슬롯 사이에 10초 대기 (스팸 방지)
    if (slot.channel === 'naver_cafe' && prevWasNaverCafe) {
      console.log('[cron/schedule-publish] 네이버 카페 스팸 방지 10초 대기');
      await new Promise(r => setTimeout(r, 10_000));
    }
    prevWasNaverCafe = slot.channel === 'naver_cafe';

    // 콘텐츠 없거나 본문 비어있으면 즉시 실패
    if (!content?.textBody) {
      await prisma.scheduleSlot
        .update({
          where: { id: slot.id },
          data: { status: 'failed', lastError: '콘텐츠 없음 또는 본문 비어있음' },
        })
        .catch(() => {});
      results.push({
        slotId: slot.id,
        channel: slot.channel,
        status: 'failed',
        error: 'no content',
      });
      continue;
    }

    try {
      // publishing 상태로 전환
      await prisma.scheduleSlot.update({
        where: { id: slot.id },
        data: { status: 'publishing' },
      });

      let externalId: string | null = null;
      let externalUrl: string | null = null;

      if (slot.channel === 'naver_cafe') {
        const result = await publishNaverCafePost({
          subject: content.topic,
          content: content.textBody,
        });
        externalId = result.articleId;
        externalUrl = result.cafeUrl;
      } else if (slot.channel === 'facebook') {
        const result = await publishFacebookPost({
          imageUrl: content.imageUrl,
          message: content.textBody,
        });
        externalId = result.id;
        externalUrl = `https://facebook.com/${result.id}`;
      } else if (slot.channel === 'instagram') {
        const bodyUrls = (content.bodyImageUrls as string[]) ?? [];
        if (bodyUrls.length >= 2) {
          // 캐러셀 발행 (카드 이미지 2장 이상)
          const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
          const absoluteUrls = bodyUrls.map(u => u.startsWith('http') ? u : `${appUrl}${u}`);
          const result = await publishInstagramCarousel({
            imageUrls: absoluteUrls,
            caption: content.textBody,
          });
          externalId = result.id;
        } else {
          if (!content.imageUrl) {
            throw new Error('인스타그램 발행에 이미지 URL 필수');
          }
          const result = await publishInstagramImage({
            imageUrl: content.imageUrl,
            caption: content.textBody,
          });
          externalId = result.id;
          externalUrl = result.permalink ?? null;
        }
      }

      // 성공: published 상태 + 발행 정보 저장
      await prisma.scheduleSlot.update({
        where: { id: slot.id },
        data: {
          status: 'published',
          publishedAt: new Date(),
          externalId,
          externalUrl,
        },
      });

      // audit log
      await logAudit({
        actor: null,
        action: AUDIT_ACTIONS.CRON_SCHEDULE_PUBLISH,
        targetType: 'schedule_slot',
        targetId: slot.id,
        payload: { contentId: content.id, channel: slot.channel, externalId },
      });

      results.push({ slotId: slot.id, channel: slot.channel, status: 'published' });
      console.log(`[cron/schedule-publish] ✓ ${slot.channel} — slot ${slot.id}`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[cron/schedule-publish] ✗ ${slot.channel} — slot ${slot.id}:`, errorMsg);

      const newRetryCount = slot.retryCount + 1;

      // 재시도 3회 초과 → failed, 이하 → scheduled 유지 (다음 크론에서 재시도)
      await prisma.scheduleSlot
        .update({
          where: { id: slot.id },
          data: {
            status: newRetryCount >= MAX_RETRY ? 'failed' : 'scheduled',
            retryCount: newRetryCount,
            lastError: errorMsg,
          },
        })
        .catch(() => {});

      // audit log (실패)
      await logAudit({
        actor: null,
        action: AUDIT_ACTIONS.CRON_SCHEDULE_PUBLISH,
        targetType: 'schedule_slot',
        targetId: slot.id,
        payload: {
          contentId: content.id,
          channel: slot.channel,
          error: errorMsg,
          retryCount: newRetryCount,
        },
      }).catch(() => {});

      results.push({ slotId: slot.id, channel: slot.channel, status: 'failed', error: errorMsg });
      // 다음 슬롯 계속 진행
    }
  }

  const published = results.filter((r) => r.status === 'published').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  console.log(`[cron/schedule-publish] 완료 — 성공: ${published}, 실패: ${failed}`);

  return NextResponse.json({
    ok: true,
    processed: slots.length,
    published,
    failed,
    results,
  });
}
