// app/api/cron/topics-refresh/route.ts — 주간 추천 토픽 자동 생성 cron (독립 엔드포인트)
// 참고: content-generate cron에도 동일 로직이 통합되어 있음 (매주 월요일 자동 실행)
// 이 엔드포인트는 수동 호출 용도로 유지

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { calcChatKrw } from '@/lib/claude/chat';
import { trackCost } from '@/lib/cost/tracker';
import { logAudit, AUDIT_ACTIONS } from '@/lib/audit/logger';
import { fetchPopularPages, type PopularPage } from '@/lib/ga4/popular-pages';
import { buildCandidates } from '@/lib/topics/candidates';
import { recommendTopFive } from '@/lib/topics/recommend';
import { getMondayOfWeekKST } from '@/lib/topics/week-utils';
import { Prisma } from '@prisma/client';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

function verifyCronSecret(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const weekStart = getMondayOfWeekKST();
  const monthYmd = weekStart.slice(0, 7) + '-01';
  console.log(`[cron/topics-refresh] 실행 시작 — weekStart=${weekStart}`);

  try {
    // 이미 이번 주 토픽이 있으면 스킵
    const existing = await prisma.topicRecommendation.count({
      where: { weekStart, channel: 'blog' },
    });
    if (existing >= 5) {
      console.log(`[cron/topics-refresh] 이미 ${existing}건 존재 — 스킵`);
      return NextResponse.json({ ok: true, skipped: true, existing, weekStart });
    }

    // 발행된 토픽 (회피)
    const contents = await prisma.content.findMany({
      select: { topic: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const publishedTopics = contents.map(c => c.topic).filter((t): t is string => !!t);

    // GA4 인기 page (실패해도 진행)
    let ga4Popular: PopularPage[] | null = null;
    let ga4Unavailable = false;
    try {
      ga4Popular = await fetchPopularPages(30);
      if (ga4Popular === null) ga4Unavailable = true;
    } catch (err) {
      console.warn('[cron/topics-refresh] GA4 실패 (무시):', err);
      ga4Unavailable = true;
    }

    // 후보 생성
    const candidates = buildCandidates({
      monthYmd,
      publishedTopics,
      ga4PopularPaths: ga4Popular ?? undefined,
    });

    if (candidates.length === 0) {
      console.error('[cron/topics-refresh] 후보 0건');
      return NextResponse.json({ ok: false, error: 'no_candidates', weekStart }, { status: 500 });
    }

    // GPT-4o TOP5 추천
    const recommended = await recommendTopFive({
      monthYmd,
      candidates,
      channel: 'blog',
    });

    // 같은 주 DELETE → INSERT
    await prisma.topicRecommendation.deleteMany({
      where: { weekStart, channel: 'blog' },
    });

    // ownerId 결정: 첫 번째 유저 또는 'system'
    const anyUser = await prisma.user.findFirst({ select: { id: true }, orderBy: { createdAt: 'asc' } });
    const cronOwnerId = anyUser?.id ?? 'system';

    const signalsByTopic = new Map(candidates.map(c => [c.topic, c.signal]));
    const rows = recommended.items.map(item => {
      const factors: Record<string, Prisma.InputJsonValue> = {
        tags: item.tags as unknown as Prisma.InputJsonValue,
        reason: item.reason,
        signal: signalsByTopic.get(item.topic) ?? 'core',
      };
      if (ga4Unavailable) factors.ga4_unavailable = true;
      return {
        ownerId: cronOwnerId,
        weekStart,
        topic: item.topic,
        score: item.score,
        channel: 'blog' as const,
        factors: factors as Prisma.InputJsonValue,
      };
    });

    const inserted = await prisma.$transaction(
      rows.map(row => prisma.topicRecommendation.create({ data: row })),
    );

    // cost 적재
    const krw = calcChatKrw(recommended.usage);
    await trackCost({
      ownerId: cronOwnerId,
      kind: 'chat',
      tokensIn: recommended.usage.prompt_tokens,
      tokensOut: recommended.usage.completion_tokens,
      krw,
    });

    // audit
    await logAudit({
      actor: null,
      action: AUDIT_ACTIONS.CRON_TOPICS_REFRESH,
      targetType: 'topic_recommendations',
      targetId: weekStart,
      payload: {
        weekStart,
        count: inserted.length,
        ga4_unavailable: ga4Unavailable,
        cost_krw: krw,
      },
    });

    console.log(`[cron/topics-refresh] 완료 — ${inserted.length}건 생성`);
    return NextResponse.json({ ok: true, weekStart, count: inserted.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cron/topics-refresh] 실패:', msg);
    return NextResponse.json({ ok: false, error: msg, weekStart }, { status: 500 });
  }
}
