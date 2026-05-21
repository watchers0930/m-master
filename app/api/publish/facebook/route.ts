// app/api/publish/facebook/route.ts
// POST { content_id } → FB Pages API 발행 → schedule_slots 'published' 1건 적재
// 인증 필수, audit_log 적재

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { publishFacebookPost } from '@/lib/publish/facebook';
import { logAudit, AUDIT_ACTIONS } from '@/lib/audit/logger';

const RequestSchema = z.object({
  content_id: z.string().uuid('content_id는 UUID 형식이어야 합니다'),
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
    select: { id: true, textBody: true, imageUrl: true, bodyImageUrls: true, topic: true },
  });

  if (!content) {
    return NextResponse.json({ error: { code: 'not_found', message: '콘텐츠를 찾을 수 없습니다' } }, { status: 404 });
  }

  // 페북은 이미지가 없으면 텍스트 피드로 게시
  const imageUrl =
    content.imageUrl ||
    (Array.isArray(content.bodyImageUrls) ? (content.bodyImageUrls as string[]).find((u) => typeof u === 'string' && u.length > 0) : null) ||
    null;

  const messageSource = content.textBody || content.topic || '';

  let publishResult;
  try {
    publishResult = await publishFacebookPost({
      imageUrl,
      message: messageSource,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[publish/facebook] 발행 실패:', msg);
    return NextResponse.json(
      { error: { code: 'publish_failed', message: msg } },
      { status: 502 },
    );
  }

  // post_id 우선 사용 (페이지 게시물 URL 구성에 유리), 없으면 id
  const externalId = publishResult.postId || publishResult.id;
  const externalUrl = `https://www.facebook.com/${externalId}`;

  const now = new Date().toISOString();
  try {
    await prisma.scheduleSlot.create({
      data: {
        contentId: content_id,
        channel: 'facebook',
        scheduledAt: now,
        publishedAt: now,
        status: 'published',
        mode: 'manual',
        externalId,
        externalUrl,
      },
    });
  } catch (slotError) {
    console.error('[publish/facebook] schedule_slots insert 실패:', slotError);
  }

  await logAudit({
    actor: ownerId,
    action: AUDIT_ACTIONS.PUBLISH_FACEBOOK,
    targetType: 'content',
    targetId: content_id,
    payload: { fb_id: externalId },
  });

  return NextResponse.json({
    data: {
      id: externalId,
      url: externalUrl,
    },
    error: null,
  });
}
