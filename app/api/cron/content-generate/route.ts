// app/api/cron/content-generate/route.ts — 일일 자동 콘텐츠 생성 + 매월 1일 토픽 리프레시
// Vercel Cron: 0 22 * * * (UTC) = 오전 7시 KST
// 1) 매월 1일: 추천 토픽 자동 생성 (topics-refresh 통합)
// 2) 매일: ContentPlanItem(scheduledDate=오늘, status=planned, plan.autoGenerate=true) 순차 생성·발행

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateContentHeadless } from '@/lib/content/generate-headless';
import { autoPublishToSocial } from '@/lib/publish/auto-publish';
import { logAudit, AUDIT_ACTIONS } from '@/lib/audit/logger';
import { calcChatKrw } from '@/lib/claude/chat';
import { trackCost } from '@/lib/cost/tracker';
import { fetchPopularPages, type PopularPage } from '@/lib/ga4/popular-pages';
import { buildCandidates } from '@/lib/topics/candidates';
import { recommendTopFive } from '@/lib/topics/recommend';
import { Prisma } from '@prisma/client';

export const maxDuration = 300; // 5분 (Vercel Pro)
export const dynamic = 'force-dynamic';

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
// 오늘 날짜 (KST) → 'YYYY-MM-DD'
// ---------------------------------------------------------------------------
function getTodayKST(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// 매월 1일: 추천 토픽 리프레시 (topics-refresh 통합)
// ---------------------------------------------------------------------------
async function maybeRefreshTopics(today: string): Promise<{ ran: boolean; count?: number; error?: string }> {
  const day = parseInt(today.slice(8, 10), 10);
  if (day !== 1) return { ran: false };

  const monthYmd = today.slice(0, 7) + '-01'; // YYYY-MM-01
  console.log(`[cron/content-generate] 매월 1일 — 토픽 리프레시 시작 (${monthYmd})`);

  try {
    const existing = await prisma.topicRecommendation.count({
      where: { month: monthYmd, channel: 'blog' },
    });
    if (existing >= 5) {
      console.log(`[cron/content-generate] 토픽 이미 ${existing}건 존재 — 스킵`);
      return { ran: true, count: existing };
    }

    const contents = await prisma.content.findMany({
      select: { topic: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const publishedTopics = contents.map(c => c.topic).filter((t): t is string => !!t);

    let ga4Popular: PopularPage[] | null = null;
    let ga4Unavailable = false;
    try {
      ga4Popular = await fetchPopularPages(30);
      if (ga4Popular === null) ga4Unavailable = true;
    } catch {
      ga4Unavailable = true;
    }

    const candidates = buildCandidates({
      monthYmd,
      publishedTopics,
      ga4PopularPaths: ga4Popular ?? undefined,
    });
    if (candidates.length === 0) {
      console.error('[cron/content-generate] 토픽 후보 0건');
      return { ran: true, error: 'no_candidates' };
    }

    const recommended = await recommendTopFive({ monthYmd, candidates, channel: 'blog' });

    await prisma.topicRecommendation.deleteMany({
      where: { month: monthYmd, channel: 'blog' },
    });

    const signalsByTopic = new Map(candidates.map(c => [c.topic, c.signal]));
    const rows = recommended.items.map(item => {
      const factors: Record<string, Prisma.InputJsonValue> = {
        tags: item.tags as unknown as Prisma.InputJsonValue,
        reason: item.reason,
        signal: signalsByTopic.get(item.topic) ?? 'core',
      };
      if (ga4Unavailable) factors.ga4_unavailable = true;
      return {
        month: monthYmd,
        topic: item.topic,
        score: item.score,
        channel: 'blog' as const,
        factors: factors as Prisma.InputJsonValue,
      };
    });

    const inserted = await prisma.$transaction(
      rows.map(row => prisma.topicRecommendation.create({ data: row })),
    );

    const krw = calcChatKrw(recommended.usage);
    await trackCost({
      kind: 'chat',
      tokensIn: recommended.usage.prompt_tokens,
      tokensOut: recommended.usage.completion_tokens,
      krw,
    });

    await logAudit({
      actor: null,
      action: AUDIT_ACTIONS.CRON_TOPICS_REFRESH,
      targetType: 'topic_recommendations',
      targetId: monthYmd,
      payload: { month: monthYmd, count: inserted.length, ga4_unavailable: ga4Unavailable, cost_krw: krw },
    });

    console.log(`[cron/content-generate] 토픽 리프레시 완료 — ${inserted.length}건`);
    return { ran: true, count: inserted.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cron/content-generate] 토픽 리프레시 실패:', msg);
    return { ran: true, error: msg };
  }
}

// ---------------------------------------------------------------------------
// GET handler (Vercel Cron은 GET으로 호출)
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const today = getTodayKST();
  console.log(`[cron/content-generate] 실행 시작 — 날짜: ${today}`);

  // 매월 1일: 토픽 리프레시
  const topicsResult = await maybeRefreshTopics(today);
  if (topicsResult.ran) {
    console.log(`[cron/content-generate] 토픽 리프레시: ${topicsResult.error ? '실패 - ' + topicsResult.error : topicsResult.count + '건'}`);
  }

  // 오늘 예정된 planned 항목 조회 (autoGenerate=true인 플랜만)
  const items = await prisma.contentPlanItem.findMany({
    where: {
      scheduledDate: today,
      status: 'planned',
      plan: {
        autoGenerate: true,
        status: 'active',
      },
    },
    include: {
      plan: { select: { ownerId: true } },
    },
    orderBy: { sortOrder: 'asc' },
  });

  if (items.length === 0) {
    console.log('[cron/content-generate] 오늘 예정 항목 없음');
    return NextResponse.json({ ok: true, processed: 0, date: today });
  }

  console.log(`[cron/content-generate] ${items.length}건 처리 시작`);

  const results: Array<{ itemId: string; status: string; contentId?: string; error?: string }> = [];

  for (const item of items) {
    const ownerId = item.plan.ownerId;

    try {
      // item.status → generating
      await prisma.contentPlanItem.update({
        where: { id: item.id },
        data: { status: 'generating' },
      });

      // 콘텐츠 생성
      const result = await generateContentHeadless({
        topic: item.topic,
        channel: 'blog',
        ownerId,
      });

      // 소셜 자동 발행 (onProgress는 no-op)
      await autoPublishToSocial({
        blogContentId: result.contentId,
        ownerId,
        blogText: result.text,
        topic: item.topic,
        imageUrl: result.imageUrl,
        bodyImageUrls: result.bodyImageUrls,
        onProgress: () => {},
      });

      // item.status → generated
      await prisma.contentPlanItem.update({
        where: { id: item.id },
        data: {
          status: 'generated',
          contentJobId: result.contentId,
          generatedAt: new Date(),
        },
      });

      // audit log
      await logAudit({
        actor: null,
        action: AUDIT_ACTIONS.CRON_CONTENT_GENERATE,
        targetType: 'content_plan_item',
        targetId: item.id,
        payload: {
          contentId: result.contentId,
          topic: item.topic,
          costKrw: result.costKrw,
          date: today,
        },
      });

      results.push({ itemId: item.id, status: 'generated', contentId: result.contentId });
      console.log(`[cron/content-generate] ✓ ${item.topic} → ${result.contentId}`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[cron/content-generate] ✗ ${item.topic}:`, errorMsg);

      // item.status → failed
      await prisma.contentPlanItem.update({
        where: { id: item.id },
        data: { status: 'failed' },
      }).catch(() => {});

      // audit log (실패)
      await logAudit({
        actor: null,
        action: AUDIT_ACTIONS.CRON_CONTENT_GENERATE,
        targetType: 'content_plan_item',
        targetId: item.id,
        payload: { topic: item.topic, error: errorMsg, date: today },
      }).catch(() => {});

      results.push({ itemId: item.id, status: 'failed', error: errorMsg });
      // 다음 항목 계속 진행
    }
  }

  const generated = results.filter((r) => r.status === 'generated').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  console.log(`[cron/content-generate] 완료 — 성공: ${generated}, 실패: ${failed}`);

  return NextResponse.json({
    ok: true,
    date: today,
    processed: items.length,
    generated,
    failed,
    results,
    topicsRefresh: topicsResult.ran ? topicsResult : undefined,
  });
}
