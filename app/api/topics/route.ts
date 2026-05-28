// GET /api/topics — 이번 주 추천 토픽 TOP5 조회 (GenerateForm 모달용)

import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
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

export async function GET() {
  const session = await requireSession();
  const _ownerId = session.user.id;

  try {
    const weekStart = getMondayOfWeekKST();

    const data = await prisma.topicRecommendation.findMany({
      where: {
        weekStart,
        channel: 'blog',
      },
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
      orderBy: { score: 'desc' },
      take: 5,
    });

    return jsonOk({ items: data as unknown as TopicRecommendation[] });
  } catch (error) {
    console.error('[api/topics GET] 조회 실패:', error);
    return jsonError('db_select_failed', '추천 토픽 조회에 실패했습니다', 500);
  }
}
