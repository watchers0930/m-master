// app/api/blog-publish/pending/route.ts — 미발행 블로그 콘텐츠 조회
// GitHub Actions Playwright 스크립트가 호출하는 API
// 인증: x-api-key 헤더 (BLOG_PUBLISH_API_KEY 환경변수)

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

function getKstDayBounds(date = new Date()): { start: Date; end: Date; ymd: string } {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const ymd = kst.toISOString().slice(0, 10);
  const start = new Date(`${ymd}T00:00:00.000+09:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end, ymd };
}

function verifyApiKey(req: NextRequest): boolean {
  const key = process.env.BLOG_PUBLISH_API_KEY;
  if (!key) return false;
  return req.headers.get('x-api-key') === key;
}

export async function GET(req: NextRequest) {
  if (!verifyApiKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const today = getKstDayBounds();
  const publishedToday = await prisma.scheduleSlot.findFirst({
    where: {
      channel: 'blog',
      status: 'published',
      publishedAt: { gte: today.start, lt: today.end },
    },
    select: { id: true },
  });

  if (publishedToday) {
    return NextResponse.json({
      items: [],
      skipped: true,
      reason: 'daily_blog_publish_limit_reached',
      date: today.ymd,
    });
  }

  // channel='blog', status='draft' 중 오늘 KST 생성됐고 아직 블로그에 발행 안 된 건
  // (ScheduleSlot에 channel='blog', status='published'가 없는 것)
  const items = await prisma.content.findMany({
    where: {
      channel: 'blog',
      status: 'draft',
      createdAt: { gte: today.start, lt: today.end },
      scheduleSlots: { none: { channel: 'blog', status: 'published' } },
    },
    select: {
      id: true,
      topic: true,
      textBody: true,
      imageUrl: true,
      bodyImageUrls: true,
      keywords: true,
      createdAt: true,
      ownerId: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 1, // 자동 발행은 실행당 1건만 처리
  });

  return NextResponse.json({ items, date: today.ymd });
}
