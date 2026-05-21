// app/api/schedule/slot/[id]/route.ts
// PATCH { scheduled_at?, status? } → schedule_slots 업데이트
// DELETE → 슬롯 취소 (status=cancelled)
// 인증 필수, audit_log 적재

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logAudit, AUDIT_ACTIONS } from '@/lib/audit/logger';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PatchSchema = z.object({
  scheduled_at: z
    .string()
    .datetime({ message: 'scheduled_at은 ISO 8601 형식이어야 합니다' })
    .refine((dt) => new Date(dt) > new Date(), '예약 시각은 현재 시각 이후여야 합니다')
    .optional(),
  status: z
    .enum(['scheduled', 'cancelled'])
    .optional(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

// ----------------------------------------------------------------
// 슬롯 소유권 확인 헬퍼
// ----------------------------------------------------------------
async function findSlotByOwner(
  slotId: string,
  ownerId: string,
): Promise<{ id: string; status: string; contentId: string } | null> {
  const slot = await prisma.scheduleSlot.findUnique({
    where: { id: slotId },
    select: { id: true, status: true, contentId: true },
  });

  if (!slot) return null;
  const contentId = slot.contentId;
  if (!contentId) return null;

  // content를 통해 owner 확인
  const content = await prisma.content.findFirst({
    where: { id: contentId, ownerId },
    select: { id: true },
  });

  if (!content) return null;
  return { id: slot.id, status: slot.status, contentId };
}

// ----------------------------------------------------------------
// PATCH
// ----------------------------------------------------------------
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const session = await requireSession();
  const ownerId = session.user.id;

  const { id: slotId } = await params;
  if (!UUID_RE.test(slotId)) {
    return NextResponse.json({ error: { code: 'validation', message: '유효하지 않은 id' } }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: 'bad_request', message: 'JSON 파싱 실패' } }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'validation', message: parsed.error.issues[0]?.message ?? 'validation error' } },
      { status: 400 },
    );
  }

  const slot = await findSlotByOwner(slotId, ownerId);
  if (!slot) {
    return NextResponse.json({ error: { code: 'not_found', message: '슬롯을 찾을 수 없습니다' } }, { status: 404 });
  }

  if (!['scheduled'].includes(slot.status)) {
    return NextResponse.json(
      { error: { code: 'conflict', message: `${slot.status} 상태의 슬롯은 수정할 수 없습니다` } },
      { status: 409 },
    );
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.scheduled_at) update.scheduledAt = parsed.data.scheduled_at;
  if (parsed.data.status) update.status = parsed.data.status;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: { code: 'bad_request', message: '변경할 필드가 없습니다' } }, { status: 400 });
  }

  try {
    await prisma.scheduleSlot.update({
      where: { id: slotId },
      data: update,
    });
  } catch (error) {
    console.error('[schedule/slot] patch error:', error);
    return NextResponse.json({ error: { code: 'internal', message: 'DB 업데이트 실패' } }, { status: 500 });
  }

  await logAudit({
    actor: ownerId,
    action: AUDIT_ACTIONS.SCHEDULE_UPDATE,
    targetType: 'schedule_slot',
    targetId: slotId,
    payload: update as Record<string, string>,
  });

  return NextResponse.json({ data: { updated: true }, error: null });
}

// ----------------------------------------------------------------
// DELETE → status=cancelled (논리 삭제)
// ----------------------------------------------------------------
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const session = await requireSession();
  const ownerId = session.user.id;

  const { id: slotId } = await params;
  if (!UUID_RE.test(slotId)) {
    return NextResponse.json({ error: { code: 'validation', message: '유효하지 않은 id' } }, { status: 400 });
  }

  const slot = await findSlotByOwner(slotId, ownerId);
  if (!slot) {
    return NextResponse.json({ error: { code: 'not_found', message: '슬롯을 찾을 수 없습니다' } }, { status: 404 });
  }

  if (slot.status === 'published') {
    return NextResponse.json(
      { error: { code: 'conflict', message: '이미 발행된 슬롯은 삭제할 수 없습니다' } },
      { status: 409 },
    );
  }

  try {
    await prisma.scheduleSlot.update({
      where: { id: slotId },
      data: { status: 'cancelled' },
    });
  } catch (error) {
    console.error('[schedule/slot] delete error:', error);
    return NextResponse.json({ error: { code: 'internal', message: 'DB 업데이트 실패' } }, { status: 500 });
  }

  // content status를 draft로 복원
  await prisma.content.updateMany({
    where: { id: slot.contentId, status: 'scheduled' },
    data: { status: 'draft' },
  });

  await logAudit({
    actor: ownerId,
    action: AUDIT_ACTIONS.SCHEDULE_DELETE,
    targetType: 'schedule_slot',
    targetId: slotId,
    payload: { cancelled: true },
  });

  return NextResponse.json({ data: { cancelled: true }, error: null });
}
