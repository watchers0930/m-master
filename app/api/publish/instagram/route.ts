// app/api/publish/instagram/route.ts
// POST { content_id } → IG Graph API 발행 → schedule_slots 'published' 1건 적재
// 인증 필수, audit_log 적재

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { publishInstagramImage } from '@/lib/publish/instagram';
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

  // 콘텐츠 조회 — IG는 이미지 1장 + 캡션 필요
  const content = await prisma.content.findFirst({
    where: { id: content_id, ownerId },
    select: { id: true, textBody: true, imageUrl: true, bodyImageUrls: true, topic: true },
  });

  if (!content) {
    return NextResponse.json({ error: { code: 'not_found', message: '콘텐츠를 찾을 수 없습니다' } }, { status: 404 });
  }

  // 발행에 쓸 이미지: 썸네일 → 본문 첫 이미지 → 실패
  const imageUrl =
    content.imageUrl ||
    (Array.isArray(content.bodyImageUrls) ? (content.bodyImageUrls as string[]).find((u) => typeof u === 'string' && u.length > 0) : null);

  if (!imageUrl) {
    return NextResponse.json(
      { error: { code: 'bad_request', message: '인스타 발행에 필요한 이미지가 없습니다' } },
      { status: 400 },
    );
  }

  const captionSource = content.textBody || content.topic || '';

  let publishResult;
  try {
    publishResult = await publishInstagramImage({
      imageUrl,
      caption: captionSource,
      ownerId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[publish/instagram] 발행 실패:', msg);
    return NextResponse.json(
      { error: { code: 'publish_failed', message: msg } },
      { status: 502 },
    );
  }

  // schedule_slots에 published 1건 적재 (성과 분석 페이지가 여기를 읽음)
  const now = new Date().toISOString();
  try {
    await prisma.scheduleSlot.create({
      data: {
        ownerId,
        contentId: content_id,
        channel: 'instagram',
        scheduledAt: now,
        publishedAt: now,
        status: 'published',
        mode: 'manual',
        externalId: publishResult.id,
        externalUrl: `https://www.instagram.com/p/${publishResult.id}`,
      },
    });
  } catch (slotError) {
    console.error('[publish/instagram] schedule_slots insert 실패:', slotError);
    // 발행은 성공했으므로 200 유지, 경고만
  }

  await logAudit({
    actor: ownerId,
    action: AUDIT_ACTIONS.PUBLISH_INSTAGRAM,
    targetType: 'content',
    targetId: content_id,
    payload: { ig_id: publishResult.id },
  });

  return NextResponse.json({
    data: {
      id: publishResult.id,
      url: `https://www.instagram.com/p/${publishResult.id}`,
    },
    error: null,
  });
}
