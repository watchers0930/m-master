// app/api/cron/topics-refresh/route.ts — 매월 1일 추천 토픽 자동 생성 cron
// Vercel Cron: 0 21 1 * * (UTC) = 매월 1일 오전 6시 KST

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { calcChatKrw } from '@/lib/claude/chat';
import { trackCost } from '@/lib/cost/tracker';
import { logAudit, AUDIT_ACTIONS } from '@/lib/audit/logger';
import { fetchPopularPages, type PopularPage } from '@/lib/ga4/popular-pages';
import { buildCandidates } from '@/lib/topics/candidates';
import { recommendTopFive } from '@/lib/topics/recommend';
import { Prisma } from '@prisma/client';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

function verifyCronSecret(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${secret}`;
}

function getMonthYmd(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const monthYmd = getMonthYmd();
  console.log(`[cron/topics-refresh] 실행 시작 — ${monthYmd}`);

  try {
    // 이미 이번 달 토픽이 있으면 스킵
    const existing = await prisma.topicRecommendation.count({
      where: { month: monthYmd, channel: 'blog' },
    });
    if (existing >= 5) {
      console.log(`[cron/topics-refresh] 이미 ${existing}건 존재 — 스킵`);
      return NextResponse.json({ ok: true, skipped: true, existing, month: monthYmd });
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
      return NextResponse.json({ ok: false, error: 'no_candidates', month: monthYmd }, { status: 500 });
    }

    // Claude TOP5 추천
    const recommended = await recommendTopFive({
      monthYmd,
      candidates,
      channel: 'blog',
    });

    // 같은 월 DELETE → INSERT
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

    // cost 적재
    const krw = calcChatKrw(recommended.usage);
    await trackCost({
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
      targetId: monthYmd,
      payload: {
        month: monthYmd,
        count: inserted.length,
        ga4_unavailable: ga4Unavailable,
        cost_krw: krw,
      },
    });

    console.log(`[cron/topics-refresh] 완료 — ${inserted.length}건 생성`);
    return NextResponse.json({ ok: true, month: monthYmd, count: inserted.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cron/topics-refresh] 실패:', msg);
    return NextResponse.json({ ok: false, error: msg, month: monthYmd }, { status: 500 });
  }
}
