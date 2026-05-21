// app/api/schedule/manual/route.ts
// POST { content_id, channel, scheduled_at } → schedule_slots insert
// 인증 필수, audit_log 적재

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logAudit, AUDIT_ACTIONS } from '@/lib/audit/logger';

const RequestSchema = z.object({
  content_id: z.string().uuid('content_id는 UUID 형식이어야 합니다'),
  channel: z.enum(['blog', 'instagram', 'facebook']),
  scheduled_at: z
    .string()
    .datetime({ message: 'scheduled_at은 ISO 8601 형식이어야 합니다' })
    .refine(
      (dt) => new Date(dt) > new Date(),
      '예약 시각은 현재 시각 이후여야 합니다',
    ),
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

  const { content_id, channel, scheduled_at } = parsed.data;

  // 3) content 소유권 확인
  const contentRow = await prisma.content.findFirst({
    where: { id: content_id, ownerId },
    select: { id: true, channel: true, status: true },
  });

  if (!contentRow) {
    return NextResponse.json({ error: { code: 'not_found', message: '콘텐츠를 찾을 수 없습니다' } }, { status: 404 });
  }

  // 3-1) channel mismatch 방어 — content 채널과 요청 채널 일치 검증
  if (contentRow.channel !== channel) {
    return NextResponse.json(
      { error: { code: 'validation', message: `콘텐츠 채널(${contentRow.channel})과 요청 채널(${channel})이 일치하지 않습니다` } },
      { status: 400 },
    );
  }

  // 4) 동일 content_id로 이미 scheduled 슬롯 존재 확인 (중복 방지)
  const existingSlot = await prisma.scheduleSlot.findFirst({
    where: { contentId: content_id, status: 'scheduled' },
    select: { id: true },
  });

  if (existingSlot) {
    return NextResponse.json(
      { error: { code: 'conflict', message: '이미 예약된 슬롯이 있습니다. 기존 슬롯을 수정하거나 취소하세요.' } },
      { status: 409 },
    );
  }

  // 5) schedule_slots insert
  let slotData;
  try {
    slotData = await prisma.scheduleSlot.create({
      data: {
        contentId: content_id,
        channel,
        scheduledAt: scheduled_at,
        publishedAt: null,
        status: 'scheduled',
        mode: 'manual',
        externalId: null,
        externalUrl: null,
        retryCount: 0,
        lastError: null,
      },
      select: { id: true },
    });
  } catch (error) {
    console.error('[schedule/manual] insert error:', error);
    return NextResponse.json(
      { error: { code: 'internal', message: 'schedule_slots insert 실패' } },
      { status: 500 },
    );
  }

  // 6) contents status → scheduled 업데이트
  await prisma.content.update({
    where: { id: content_id },
    data: { status: 'scheduled' },
  });

  // 7) audit_log
  await logAudit({
    actor: ownerId,
    action: AUDIT_ACTIONS.SCHEDULE_CREATE,
    targetType: 'schedule_slot',
    targetId: slotData.id,
    payload: { content_id, channel, scheduled_at },
  });

  return NextResponse.json({ data: { slot_id: slotData.id }, error: null }, { status: 201 });
}
