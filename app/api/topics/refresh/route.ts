// POST /api/topics/refresh — 이번 주 추천 토픽 5건 재생성 후 INSERT
// 절차: 세션 → 후보 생성(룰 + GA4) → GPT-4o TOP5 → 같은 주 DELETE → 5건 INSERT → cost 적재 → audit

import { requireSession } from '@/lib/auth';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { calcChatKrw } from '@/lib/claude/chat';
import { trackCost } from '@/lib/cost/tracker';
import { logAudit } from '@/lib/audit/logger';
import { fetchPopularPages, type PopularPage } from '@/lib/ga4/popular-pages';
import { buildCandidates } from '@/lib/topics/candidates';
import { recommendTopFive } from '@/lib/topics/recommend';
import { getMondayOfWeekKST } from '@/lib/topics/week-utils';
import type { TopicRecommendation } from '@/types/db';

function jsonError(code: string, message: string, status: number) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonOk<T>(body: T) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST() {
  // 1) 세션
  const session = await requireSession();
  const ownerId = session.user.id;

  const weekStart = getMondayOfWeekKST();
  const monthYmd = weekStart.slice(0, 7) + '-01'; // candidates 생성용

  try {
    // 2) 이미 발행된 토픽 (회피)
    const contents = await prisma.content.findMany({
      select: { topic: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const publishedTopics = contents.map(c => c.topic).filter((t): t is string => !!t);

    // 3) GA4 인기 page (실패해도 진행)
    let ga4Popular: PopularPage[] | null = null;
    let ga4Unavailable = false;
    try {
      ga4Popular = await fetchPopularPages(30);
      if (ga4Popular === null) ga4Unavailable = true;
    } catch (err) {
      console.warn('[topics/refresh] GA4 fetchPopularPages 실패 (무시):', err);
      ga4Unavailable = true;
    }

    // 4) 후보 생성
    const candidates = buildCandidates({
      monthYmd,
      publishedTopics,
      ga4PopularPaths: ga4Popular ?? undefined,
    });

    if (candidates.length === 0) {
      return jsonError('no_candidates', '추천 후보를 생성하지 못했습니다', 500);
    }

    // 5) GPT-4o TOP5
    let recommended;
    try {
      recommended = await recommendTopFive({
        monthYmd,
        candidates,
        channel: 'blog',
      });
    } catch (err) {
      console.error('[topics/refresh] recommendTopFive 실패:', err);
      return jsonError('recommend_failed', '추천 생성에 실패했습니다', 500);
    }

    // 6) 같은 주 DELETE
    await prisma.topicRecommendation.deleteMany({
      where: {
        weekStart,
        channel: 'blog',
      },
    });

    // 7) INSERT 5건
    const signalsByTopic = new Map(candidates.map(c => [c.topic, c.signal]));
    const rows = recommended.items.map(item => {
      const factors: Record<string, Prisma.InputJsonValue> = {
        tags: item.tags as unknown as Prisma.InputJsonValue,
        reason: item.reason,
        signal: signalsByTopic.get(item.topic) ?? 'core',
      };
      if (ga4Unavailable) factors.ga4_unavailable = true;
      return {
        weekStart,
        topic: item.topic,
        score: item.score,
        channel: 'blog' as const,
        factors: factors as Prisma.InputJsonValue,
      };
    });

    const inserted = await prisma.$transaction(
      rows.map(row => prisma.topicRecommendation.create({
        data: row,
        select: {
          id: true,
          month: true,
          weekStart: true,
          topic: true,
          score: true,
          factors: true,
          channel: true,
          createdAt: true,
        },
      })),
    );

    // 8) cost_ledger
    const krw = calcChatKrw(recommended.usage);
    await trackCost({
      kind: 'chat',
      tokensIn: recommended.usage.prompt_tokens,
      tokensOut: recommended.usage.completion_tokens,
      krw,
    });

    // 9) audit_log
    await logAudit({
      actor: ownerId,
      action: 'topics.refresh',
      targetType: 'topic_recommendations',
      targetId: weekStart,
      payload: {
        weekStart,
        count: inserted.length,
        ga4_unavailable: ga4Unavailable,
        cost_krw: krw,
      },
    });

    return jsonOk({ items: inserted as unknown as TopicRecommendation[] });
  } catch (err) {
    console.error('[topics/refresh] 처리 실패:', err);
    return jsonError('internal_error', '처리 중 오류가 발생했습니다', 500);
  }
}
