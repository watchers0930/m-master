// scripts/seed-topics.ts — 토픽 임의 생성 일회성 스크립트
// 실행: npx tsx scripts/seed-topics.ts

import { config } from 'dotenv';
config({ path: '.env.local' });

import { PrismaClient, Prisma } from '@prisma/client';
import { buildCandidates } from '../lib/topics/candidates';
import { recommendTopFive } from '../lib/topics/recommend';

const prisma = new PrismaClient();

function getMonthYmd(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

async function main() {
  const monthYmd = getMonthYmd();
  console.log(`[seed-topics] ${monthYmd} 토픽 생성 시작`);

  // 이미 존재하면 삭제 후 재생성
  const existing = await prisma.topicRecommendation.count({
    where: { month: monthYmd, channel: 'blog' },
  });
  if (existing > 0) {
    console.log(`[seed-topics] 기존 ${existing}건 삭제`);
    await prisma.topicRecommendation.deleteMany({
      where: { month: monthYmd, channel: 'blog' },
    });
  }

  // 발행된 토픽 조회
  const contents = await prisma.content.findMany({
    select: { topic: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  const publishedTopics = contents.map(c => c.topic).filter((t): t is string => !!t);

  // 후보 생성
  const candidates = buildCandidates({
    monthYmd,
    publishedTopics,
    ga4PopularPaths: [],
  });
  console.log(`[seed-topics] 후보 ${candidates.length}개 생성`);

  // Claude TOP5
  console.log('[seed-topics] Claude 추천 요청 중...');
  const recommended = await recommendTopFive({
    monthYmd,
    candidates,
    channel: 'blog',
  });

  // DB INSERT
  const signalsByTopic = new Map(candidates.map(c => [c.topic, c.signal]));
  const rows = recommended.items.map(item => {
    const factors: Record<string, Prisma.InputJsonValue> = {
      tags: item.tags as unknown as Prisma.InputJsonValue,
      reason: item.reason,
      signal: signalsByTopic.get(item.topic) ?? 'core',
    };
    return {
      ownerId: 'seed-admin',
      month: monthYmd,
      topic: item.topic,
      score: item.score,
      channel: 'blog' as const,
      factors: factors as Prisma.InputJsonValue,
    };
  });

  const inserted = await prisma.$transaction(
    rows.map(row => prisma.topicRecommendation.create({
      data: row,
      select: { id: true, topic: true, score: true },
    })),
  );

  console.log(`\n[seed-topics] 완료! ${inserted.length}건 생성:`);
  inserted.forEach((t, i) => {
    console.log(`  ${i + 1}. [${Math.round(t.score)}점] ${t.topic}`);
  });

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('[seed-topics] 실패:', err);
  process.exit(1);
});
