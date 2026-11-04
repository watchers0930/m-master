// GET /api/topics — 이번 주 추천 토픽 TOP5 조회 (GenerateForm 모달용)
// 쓰기(lib/topics/persist.ts)와 같은 도메인 범위로 읽는다: factors.domainId 가 일치하는 행만.
// domainId 가 없는 레거시 행은 어떤 도메인 범위에도 속하지 않으므로 제외된다.
import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticated, queryParams, notFound } from '@/lib/visibility/http';
import { getMondayOfWeekKST } from '@/lib/topics/week-utils';
import type { TopicRecommendation } from '@/types/db';
const schema = z.object({ domain_id: z.string().min(1).max(200).optional() }).strict();
export async function GET(request: Request) {
  return authenticated(async ownerId => {
    const input = schema.parse(queryParams(request));
    // 기본 범위 = refreshTopics 와 동일(요청 도메인 ?? 자동화 도메인 ?? 도메인 없음)
    const setting = input.domain_id ? null : await prisma.setting.findUnique({ where: { ownerId }, select: { automationDomainId: true } });
    const domainId = input.domain_id ?? setting?.automationDomainId ?? null;
    if (input.domain_id && !await prisma.domain.findFirst({ where: { id: input.domain_id, ownerId }, select: { id: true } })) notFound();
    const data = await prisma.topicRecommendation.findMany({
      where: { ownerId, weekStart: getMondayOfWeekKST(), channel: 'blog',
        factors: { path: ['domainId'], equals: domainId === null ? Prisma.JsonNull : domainId } },
      select: { id: true, month: true, weekStart: true, topic: true, score: true, factors: true, channel: true, createdAt: true },
      orderBy: [{ score: 'desc' }, { id: 'asc' }],
      take: 5,
    });
    return NextResponse.json({ items: data as unknown as TopicRecommendation[] });
  }, request);
}
