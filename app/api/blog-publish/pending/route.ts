// app/api/blog-publish/pending/route.ts — 미발행 블로그 콘텐츠 조회
// GitHub Actions Playwright 스크립트가 호출하는 API
// 인증: x-api-key 헤더 (BLOG_PUBLISH_API_KEY 환경변수)

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

function verifyApiKey(req: NextRequest): boolean {
  const key = process.env.BLOG_PUBLISH_API_KEY;
  if (!key) return false;
  return req.headers.get('x-api-key') === key;
}

export async function GET(req: NextRequest) {
  if (!verifyApiKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // channel='blog', status='draft' 중 아직 블로그에 발행 안 된 건
  // (ScheduleSlot에 channel='blog', status='published'가 없는 것)
  const items = await prisma.content.findMany({
    where: {
      channel: 'blog',
      status: 'draft',
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
    orderBy: { createdAt: 'asc' },
    take: 5, // 한 번에 최대 5건
  });

  return NextResponse.json({ items });
}
