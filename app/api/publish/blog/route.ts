// app/api/publish/blog/route.ts
// POST { content_id } → HTML 파일 생성 → Storage 업로드 → download URL 반환
// 인증 필수, audit_log 적재

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { upload, getPublicUrl } from '@/lib/storage';
import { generateBlogHtml } from '@/lib/publish/blog-html';
import { logAudit, AUDIT_ACTIONS } from '@/lib/audit/logger';

const RequestSchema = z.object({
  content_id: z.string().uuid('content_id는 UUID 형식이어야 합니다'),
});

export async function POST(request: NextRequest) {
  // 1) 세션 검증
  const session = await requireSession();
  const ownerId = session.user.id;

  // 2) zod 검증
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: 'bad_request', message: 'JSON 파싱 실패' } }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'validation', message: parsed.error.issues[0]?.message ?? 'validation error' } },
      { status: 400 },
    );
  }

  const { content_id } = parsed.data;

  // 3) content 소유권 확인
  const contentRow = await prisma.content.findFirst({
    where: { id: content_id, ownerId },
    select: { id: true, channel: true },
  });

  if (!contentRow) {
    return NextResponse.json({ error: { code: 'not_found', message: '콘텐츠를 찾을 수 없습니다' } }, { status: 404 });
  }

  if (contentRow.channel !== 'blog') {
    return NextResponse.json(
      { error: { code: 'bad_request', message: '블로그 채널 콘텐츠만 HTML export 가능합니다' } },
      { status: 400 },
    );
  }

  // 4) HTML 생성
  let html: string;
  let filename: string;
  try {
    ({ html, filename } = await generateBlogHtml(content_id));
  } catch (err) {
    console.error('[publish/blog] HTML 생성 실패:', err);
    return NextResponse.json(
      { error: { code: 'internal', message: 'HTML 생성 실패' } },
      { status: 500 },
    );
  }

  // 5) Storage에 HTML 업로드
  const storagePath = `blog-exports/${ownerId}/${filename}`;
  const htmlBuffer = Buffer.from(html, 'utf-8');

  try {
    await upload('blog-exports', storagePath, htmlBuffer);
  } catch (err) {
    console.error('[publish/blog] storage upload 실패:', err);
    return NextResponse.json(
      { error: { code: 'internal', message: 'Storage 업로드 실패' } },
      { status: 500 },
    );
  }

  // 6) public URL 생성
  const downloadUrl = getPublicUrl('blog-exports', storagePath);

  // 7) contents status 업데이트 → published
  await prisma.content.update({
    where: { id: content_id },
    data: { status: 'published' },
  });

  // 8) audit_log
  await logAudit({
    actor: ownerId,
    action: AUDIT_ACTIONS.PUBLISH_BLOG,
    targetType: 'content',
    targetId: content_id,
    payload: { filename, storage_path: storagePath },
  });

  return NextResponse.json({
    data: { html, filename, download_url: downloadUrl },
    error: null,
  });
}
