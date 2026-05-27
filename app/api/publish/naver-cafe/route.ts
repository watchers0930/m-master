// app/api/publish/naver-cafe/route.ts
// POST { content_id } → 네이버 카페 API 발행 → schedule_slots 'published' 1건 적재
// 인증 필수, audit_log 적재

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { publishNaverCafePost } from '@/lib/publish/naver-cafe';
import { logAudit, AUDIT_ACTIONS } from '@/lib/audit/logger';

const RequestSchema = z.object({
  content_id: z.string().min(1, 'content_id는 필수입니다'),
});

export async function POST(request: NextRequest) {
  const session = await requireSession();
  const ownerId = session.user.id;

  let body: unknown;
  try { body = await request.json(); } catch {
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

  const content = await prisma.content.findFirst({
    where: { id: content_id, ownerId },
    select: { id: true, textBody: true, topic: true, bodyImageUrls: true },
  });

  if (!content) {
    return NextResponse.json({ error: { code: 'not_found', message: '콘텐츠를 찾을 수 없습니다' } }, { status: 404 });
  }

  const subject = content.topic || '새 게시글';
  const contentText = content.textBody || content.topic || '';
  const imageUrls = (content.bodyImageUrls ?? []).filter((u: string) => u && u.trim() !== '');

  let publishResult;
  try {
    publishResult = await publishNaverCafePost({
      subject,
      content: contentText,
      imageUrls,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[publish/naver-cafe] 발행 실패:', msg);
    return NextResponse.json(
      { error: { code: 'publish_failed', message: msg } },
      { status: 502 },
    );
  }

  const now = new Date().toISOString();
  try {
    await prisma.scheduleSlot.create({
      data: {
        contentId: content_id,
        channel: 'naver_cafe',
        scheduledAt: now,
        publishedAt: now,
        status: 'published',
        mode: 'manual',
        externalId: publishResult.articleId,
        externalUrl: publishResult.cafeUrl,
      },
    });
  } catch (slotError) {
    console.error('[publish/naver-cafe] schedule_slots insert 실패:', slotError);
  }

  await logAudit({
    actor: ownerId,
    action: AUDIT_ACTIONS.PUBLISH_NAVER_CAFE,
    targetType: 'content',
    targetId: content_id,
    payload: { article_id: publishResult.articleId, cafe_url: publishResult.cafeUrl },
  });

  return NextResponse.json({
    data: {
      id: publishResult.articleId,
      url: publishResult.cafeUrl,
    },
    error: null,
  });
}
