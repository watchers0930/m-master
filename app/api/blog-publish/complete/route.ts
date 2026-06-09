// app/api/blog-publish/complete/route.ts — 블로그 발행 완료 보고
// GitHub Actions Playwright 스크립트가 발행 성공 후 호출
// 인증: x-api-key 헤더 (BLOG_PUBLISH_API_KEY 환경변수)

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

function verifyApiKey(req: NextRequest): boolean {
  const key = process.env.BLOG_PUBLISH_API_KEY;
  if (!key) return false;
  return req.headers.get('x-api-key') === key;
}

interface CompleteBody {
  contentId: string;
  externalUrl: string;
}

export async function POST(req: NextRequest) {
  if (!verifyApiKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as CompleteBody;
  if (!body.contentId || !body.externalUrl) {
    return NextResponse.json({ error: 'contentId and externalUrl required' }, { status: 400 });
  }

  // 콘텐츠 존재 확인
  const content = await prisma.content.findUnique({
    where: { id: body.contentId },
    select: { id: true, ownerId: true, channel: true },
  });
  if (!content || content.channel !== 'blog') {
    return NextResponse.json({ error: 'Content not found' }, { status: 404 });
  }

  // status → published
  await prisma.content.update({
    where: { id: body.contentId },
    data: { status: 'published' },
  });

  // ScheduleSlot 생성
  await prisma.scheduleSlot.create({
    data: {
      ownerId: content.ownerId,
      contentId: body.contentId,
      channel: 'blog',
      scheduledAt: new Date(),
      publishedAt: new Date(),
      status: 'published',
      mode: 'ai_auto',
      externalUrl: body.externalUrl,
    },
  });

  return NextResponse.json({ ok: true });
}
