// app/api/cron/schedule-publish/route.ts — 예약 발행 자동화 cron
// Vercel Cron: 0 23 * * * (UTC) = 오전 8시 KST
// 0) 폴백: 7시 content-generate가 랜덤 스킵했으면 ?fallback=1로 호출
// 1) 소셜 슬롯(naver_cafe/facebook/instagram) 발행
// 2) 블로그 슬롯 → 네이버 카페 자동 변환·발행

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret, getTodayKST } from '@/lib/cron/auth';
import { prisma } from '@/lib/prisma';
import { publishNaverCafePost } from '@/lib/publish/naver-cafe';
import { publishFacebookPost } from '@/lib/publish/facebook';
import { publishInstagramImage, publishInstagramCarousel } from '@/lib/publish/instagram';
import { convertBlogToChannel } from '@/lib/claude/convert';
import { trackCost } from '@/lib/cost/tracker';
import { logAudit, AUDIT_ACTIONS } from '@/lib/audit/logger';
import { getCafeTargets, getNaverCafeCreds } from '@/lib/channel-credentials';
import { checkCostLimit, getUserPlan } from '@/lib/billing/limits';

export const maxDuration = 300; // 5분 (Vercel Pro)
export const dynamic = 'force-dynamic';

const MAX_RETRY = 3;

type SlotResult = { slotId: string; channel: string; status: string; error?: string };


// (isNaverCafeEnabled 전역 체크 제거 — SaaS에서는 유저별 credential 확인 필요)

// ---------------------------------------------------------------------------
// 1) 소셜 슬롯 발행 (기존 로직)
// ---------------------------------------------------------------------------
async function publishSocialSlots(): Promise<SlotResult[]> {
  const slots = await prisma.scheduleSlot.findMany({
    where: {
      scheduledAt: { lte: new Date() },
      status: 'scheduled',
      retryCount: { lt: MAX_RETRY },
      channel: { notIn: ['blog'] },
    },
    include: {
      content: {
        select: { id: true, textBody: true, imageUrl: true, bodyImageUrls: true, topic: true, keywords: true, ownerId: true },
      },
    },
    orderBy: [{ channel: 'asc' }, { scheduledAt: 'asc' }],
  });

  if (slots.length === 0) return [];

  console.log(`[cron/schedule-publish] 소셜 슬롯 ${slots.length}건 처리`);
  const results: SlotResult[] = [];
  let prevWasNaverCafe = false;

  for (const slot of slots) {
    const content = slot.content;

    if (slot.channel === 'naver_cafe' && prevWasNaverCafe) {
      await new Promise(r => setTimeout(r, 10_000));
    }
    prevWasNaverCafe = slot.channel === 'naver_cafe';

    if (!content?.textBody) {
      await prisma.scheduleSlot
        .update({ where: { id: slot.id }, data: { status: 'failed', lastError: '콘텐츠 없음' } })
        .catch(() => {});
      results.push({ slotId: slot.id, channel: slot.channel, status: 'failed', error: 'no content' });
      continue;
    }

    try {
      await prisma.scheduleSlot.update({ where: { id: slot.id }, data: { status: 'publishing' } });

      let externalId: string | null = null;
      let externalUrl: string | null = null;

      if (slot.channel === 'naver_cafe') {
        const bodyUrls = (content.bodyImageUrls as string[]) ?? [];
        const result = await publishNaverCafePost({ subject: content.topic, content: content.textBody, keywords: content.keywords ?? [], imageUrls: bodyUrls, imageUrl: content.imageUrl ?? undefined, ownerId: content.ownerId });
        externalId = result.articleId;
        externalUrl = result.cafeUrl;
      } else if (slot.channel === 'facebook') {
        const result = await publishFacebookPost({ imageUrl: content.imageUrl, message: content.textBody, ownerId: content.ownerId });
        externalId = result.id;
        externalUrl = `https://facebook.com/${result.id}`;
      } else if (slot.channel === 'instagram') {
        const bodyUrls = (content.bodyImageUrls as string[]) ?? [];
        if (bodyUrls.length >= 2) {
          const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
          const absoluteUrls = bodyUrls.map(u => u.startsWith('http') ? u : `${appUrl}${u}`);
          const result = await publishInstagramCarousel({ imageUrls: absoluteUrls, caption: content.textBody, ownerId: content.ownerId });
          externalId = result.id;
        } else {
          if (!content.imageUrl) throw new Error('인스타그램 발행에 이미지 URL 필수');
          const result = await publishInstagramImage({ imageUrl: content.imageUrl, caption: content.textBody, ownerId: content.ownerId });
          externalId = result.id;
          externalUrl = result.permalink ?? null;
        }
      }

      await prisma.scheduleSlot.update({
        where: { id: slot.id },
        data: { status: 'published', publishedAt: new Date(), externalId, externalUrl },
      });

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

      await logAudit({
        actor: null,
        action: AUDIT_ACTIONS.CRON_SCHEDULE_PUBLISH,
        targetType: 'schedule_slot',
        targetId: slot.id,
        payload: { contentId: content.id, channel: slot.channel, error: errorMsg, retryCount: newRetryCount },
      }).catch(() => {});

      results.push({ slotId: slot.id, channel: slot.channel, status: 'failed', error: errorMsg });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// 2) 블로그 슬롯 → 네이버 카페 자동 변환·발행
// ---------------------------------------------------------------------------
async function publishBlogToNaverCafe(): Promise<SlotResult[]> {
  // 예약 시간 경과 + scheduled 상태인 blog 슬롯 (콘텐츠 있는 것만)
  const blogSlots = await prisma.scheduleSlot.findMany({
    where: {
      scheduledAt: { lte: new Date() },
      status: 'scheduled',
      channel: 'blog',
    },
    include: {
      content: {
        select: { id: true, textBody: true, imageUrl: true, topic: true, keywords: true, ownerId: true, bodyImageUrls: true },
      },
    },
    orderBy: { scheduledAt: 'asc' },
  });

  if (blogSlots.length === 0) return [];

  console.log(`[cron/schedule-publish] 블로그→카페 ${blogSlots.length}건 처리`);
  const results: SlotResult[] = [];

  for (const slot of blogSlots) {
    const content = slot.content;

    if (!content?.textBody || !content.topic) {
      await prisma.scheduleSlot
        .update({ where: { id: slot.id }, data: { status: 'failed', lastError: '콘텐츠 없음' } })
        .catch(() => {});
      results.push({ slotId: slot.id, channel: 'blog→naver_cafe', status: 'failed', error: 'no content' });
      continue;
    }

    // SaaS: 해당 유저의 네이버 카페 credential 확인
    const cafeCreds = await getNaverCafeCreds(content.ownerId);
    if (!cafeCreds) {
      console.log(`[cron/schedule-publish] [${content.ownerId}] 카페 credential 없음 — 스킵`);
      results.push({ slotId: slot.id, channel: 'blog→naver_cafe', status: 'failed', error: 'no_credentials' });
      continue;
    }

    // 비용 한도 체크 — 초과 시 변환 스킵 (슬롯 상태 유지)
    const userPlan = await getUserPlan(content.ownerId);
    try {
      await checkCostLimit(content.ownerId, userPlan);
    } catch {
      console.log(`[cron/schedule-publish] [${content.ownerId}] 비용 한도 초과 — 카페 변환 스킵`);
      results.push({ slotId: slot.id, channel: 'blog→naver_cafe', status: 'failed', error: 'cost_limit' });
      continue;
    }

    try {
      // Claude로 블로그 → 네이버 카페 변환 (변환 먼저 — 실패 시 슬롯 상태 보존)
      console.log(`[cron/schedule-publish] [${content.ownerId}] 카페 변환 중: ${content.topic}`);
      const converted = await convertBlogToChannel(content.textBody, content.topic, 'naver_cafe');

      // 변환 비용 기록
      await trackCost({
        ownerId: content.ownerId,
        kind: 'chat',
        tokensIn: converted.usage.prompt_tokens,
        tokensOut: converted.usage.completion_tokens,
        krw: converted.krw,
        contentId: content.id,
      });

      // 네이버 카페 발행 — 다중 카페 타겟 지원
      const blogImageUrls = (content.bodyImageUrls as string[]) ?? [];
      const cafeTargets = await getCafeTargets(content.ownerId);
      let anySuccess = false;

      if (cafeTargets.length > 0) {
        for (let ct = 0; ct < cafeTargets.length; ct++) {
          const target = cafeTargets[ct];
          if (ct > 0) await new Promise(r => setTimeout(r, 10_000));
          try {
            const cafeResult = await publishNaverCafePost({
              subject: content.topic,
              content: converted.text,
              keywords: content.keywords ?? [],
              imageUrls: blogImageUrls,
              imageUrl: content.imageUrl ?? undefined,
              clubId: target.clubId,
              menuId: target.menuId,
              ownerId: content.ownerId,
            });
            anySuccess = true;
            const cafeSlot = await prisma.scheduleSlot.create({
              data: {
                ownerId: content.ownerId,
                contentId: content.id, channel: 'naver_cafe',
                scheduledAt: new Date(), publishedAt: new Date(),
                status: 'published', mode: 'ai_auto',
                targetName: target.name,
                externalId: cafeResult.articleId, externalUrl: cafeResult.cafeUrl,
              },
            });
            await logAudit({
              actor: null,
              action: AUDIT_ACTIONS.CRON_SCHEDULE_PUBLISH,
              targetType: 'schedule_slot',
              targetId: cafeSlot.id,
              payload: {
                source: 'blog_auto_cafe', blogSlotId: slot.id,
                contentId: content.id, targetName: target.name,
                externalId: cafeResult.articleId, cafeUrl: cafeResult.cafeUrl,
                convertCostKrw: converted.krw,
              },
            });
            console.log(`[cron/schedule-publish] ✓ 블로그→카페 ${target.name} — ${cafeResult.cafeUrl}`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[cron/schedule-publish] ✗ 블로그→카페 ${target.name}:`, msg);
          }
        }
      } else {
        // CafeTarget 없으면 기존 방식
        const cafeResult = await publishNaverCafePost({
          subject: content.topic,
          content: converted.text,
          keywords: content.keywords ?? [],
          imageUrls: blogImageUrls,
          imageUrl: content.imageUrl ?? undefined,
          ownerId: content.ownerId,
        });
        anySuccess = true;
        const cafeSlot = await prisma.scheduleSlot.create({
          data: {
            ownerId: content.ownerId,
            contentId: content.id, channel: 'naver_cafe',
            scheduledAt: new Date(), publishedAt: new Date(),
            status: 'published', mode: 'ai_auto',
            externalId: cafeResult.articleId, externalUrl: cafeResult.cafeUrl,
          },
        });
        await logAudit({
          actor: null,
          action: AUDIT_ACTIONS.CRON_SCHEDULE_PUBLISH,
          targetType: 'schedule_slot',
          targetId: cafeSlot.id,
          payload: {
            source: 'blog_auto_cafe', blogSlotId: slot.id,
            contentId: content.id,
            externalId: cafeResult.articleId, cafeUrl: cafeResult.cafeUrl,
            convertCostKrw: converted.krw,
          },
        });
        console.log(`[cron/schedule-publish] ✓ 블로그→카페 — ${cafeResult.cafeUrl}`);
      }

      if (!anySuccess) throw new Error('모든 카페 타겟 발행 실패');

      // 변환+발행 성공 후 블로그 슬롯 → published
      await prisma.scheduleSlot.update({
        where: { id: slot.id },
        data: { status: 'published', publishedAt: new Date() },
      });

      results.push({ slotId: slot.id, channel: 'blog→naver_cafe', status: 'published' });
      console.log(`[cron/schedule-publish] ✓ 블로그→카페 완료 — ${content.topic}`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[cron/schedule-publish] ✗ 블로그→카페 — slot ${slot.id}:`, errorMsg);

      // 실패 시 블로그 슬롯 상태 유지 (scheduled) → 다음 크론에서 재시도 가능
      await logAudit({
        actor: null,
        action: AUDIT_ACTIONS.CRON_SCHEDULE_PUBLISH,
        targetType: 'schedule_slot',
        targetId: slot.id,
        payload: { source: 'blog_auto_cafe', contentId: content.id, error: errorMsg },
      }).catch(() => {});

      results.push({ slotId: slot.id, channel: 'blog→naver_cafe', status: 'failed', error: errorMsg });
    }
  }

  return results;
}


// ---------------------------------------------------------------------------
// 폴백: 7시 content-generate가 랜덤 스킵했으면 여기서 실행
// ---------------------------------------------------------------------------
async function maybeFallbackGenerate(): Promise<boolean> {
  const today = getTodayKST();
  const pendingCount = await prisma.contentPlanItem.count({
    where: {
      scheduledDate: today,
      status: 'planned',
      plan: { autoGenerate: true, status: 'active' },
    },
  });

  if (pendingCount === 0) return false;

  console.log(`[cron/schedule-publish] 폴백: ${pendingCount}건 미생성 → content-generate 호출`);

  const secret = process.env.CRON_SECRET ?? '';
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL ?? 'localhost:3000';
  const baseUrl = host.startsWith('http') ? host : `https://${host}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 240_000); // 4분 타임아웃
    const res = await fetch(`${baseUrl}/api/cron/content-generate?fallback=1`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await res.json();
    console.log(`[cron/schedule-publish] 폴백 완료:`, JSON.stringify(data));
    return true;
  } catch (err) {
    console.error(`[cron/schedule-publish] 폴백 실패:`, err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// GET handler (Vercel Cron은 GET으로 호출)
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('[cron/schedule-publish] 실행 시작');

  // 0) 폴백: 7시 content-generate가 스킵했으면 여기서 먼저 실행
  const fallbackRan = await maybeFallbackGenerate();

  // 1) 소셜 슬롯 발행
  const socialResults = await publishSocialSlots();

  // 2) 블로그 → 네이버 카페 자동 발행
  const blogCafeResults = await publishBlogToNaverCafe();

  const results = [...socialResults, ...blogCafeResults];

  if (results.length === 0) {
    console.log('[cron/schedule-publish] 발행 대상 없음');
    return NextResponse.json({ ok: true, processed: 0, fallbackRan });
  }

  const published = results.filter((r) => r.status === 'published').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  console.log(`[cron/schedule-publish] 완료 — 성공: ${published}, 실패: ${failed}`);

  return NextResponse.json({ ok: true, processed: results.length, published, failed, results, fallbackRan });
}
