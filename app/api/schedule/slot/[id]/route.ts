// app/api/schedule/slot/[id]/route.ts
// PATCH { scheduled_at?, status? } → schedule_slots 업데이트
// DELETE → 슬롯 취소 (status=cancelled)
// 인증 필수, audit_log 적재

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { mutateIdleSlot } from '@/lib/schedule/slot-mutation';
import { prisma } from '@/lib/prisma';
import { logAudit, AUDIT_ACTIONS } from '@/lib/audit/logger';
import { isEntityId } from '@/schemas/id';

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

// 취소 가능한 상태 — publishing(발행 중)·published 는 제외
const CANCELLABLE_STATUSES = ['scheduled', 'failed'];

interface RouteParams {
  params: Promise<{ id: string }>;
}

// ----------------------------------------------------------------
// 슬롯 소유권 확인 헬퍼
// ----------------------------------------------------------------
async function findSlotByOwner(
  slotId: string,
  ownerId: string,
): Promise<{ id: string; status: string; contentId: string | null } | null> {
  // 슬롯 자체의 ownerId 로 소유권 확인 — 콘텐츠가 없는(contentId=null) 슬롯도 본인 것이면 조회 가능
  const slot = await prisma.scheduleSlot.findFirst({
    where: { id: slotId, ownerId },
    select: { id: true, status: true, contentId: true },
  });
  return slot ?? null;
}

// ----------------------------------------------------------------
// PATCH
// ----------------------------------------------------------------
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const session = await requireSession();
  const ownerId = session.user.id;

  const { id: slotId } = await params;
  if (!isEntityId(slotId)) {
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
    // 발행 claim 과 같은 행 잠금으로 직렬화 — 발행 진행 중(활성 claim)이면 409 (lib/schedule/slot-mutation.ts)
    const res = await mutateIdleSlot(ownerId, slotId, ['scheduled'], update);
    if (!res.ok) {
      const message = res.reason === 'publishing' ? '발행 진행 중인 슬롯은 수정할 수 없습니다' : '슬롯 상태가 변경되어 수정할 수 없습니다. 새로고침 후 다시 시도하세요';
      return NextResponse.json({ error: { code: 'conflict', message } }, { status: res.reason === 'not_found' ? 404 : 409 });
    }
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
  if (!isEntityId(slotId)) {
    return NextResponse.json({ error: { code: 'validation', message: '유효하지 않은 id' } }, { status: 400 });
  }

  const slot = await findSlotByOwner(slotId, ownerId);
  if (!slot) {
    return NextResponse.json({ error: { code: 'not_found', message: '슬롯을 찾을 수 없습니다' } }, { status: 404 });
  }

  if (slot.status === 'cancelled') {
    // 이미 취소된 슬롯 — 멱등 처리
    return NextResponse.json({ data: { cancelled: true }, error: null });
  }
  if (!CANCELLABLE_STATUSES.includes(slot.status)) {
    const message = slot.status === 'published'
      ? '이미 발행된 슬롯은 삭제할 수 없습니다'
      : '발행 진행 중인 슬롯은 삭제할 수 없습니다';
    return NextResponse.json({ error: { code: 'conflict', message } }, { status: 409 });
  }

  try {
    // 발행 claim 과 같은 행 잠금으로 직렬화 — 발행 진행 중(활성 claim)이면 409 (lib/schedule/slot-mutation.ts)
    const res = await mutateIdleSlot(ownerId, slotId, CANCELLABLE_STATUSES, { status: 'cancelled' });
    if (!res.ok) {
      const message = res.reason === 'publishing' ? '발행 진행 중인 슬롯은 삭제할 수 없습니다' : '슬롯 상태가 변경되어 삭제할 수 없습니다. 새로고침 후 다시 시도하세요';
      return NextResponse.json({ error: { code: 'conflict', message } }, { status: res.reason === 'not_found' ? 404 : 409 });
    }
  } catch (error) {
    console.error('[schedule/slot] delete error:', error);
    return NextResponse.json({ error: { code: 'internal', message: 'DB 업데이트 실패' } }, { status: 500 });
  }

  // content status를 draft로 복원 — 콘텐츠가 연결돼 있고, 남은 예약 슬롯이 없을 때만
  if (slot.contentId) {
    const remaining = await prisma.scheduleSlot.count({
      where: { contentId: slot.contentId, ownerId, status: { in: ['scheduled', 'publishing'] } },
    });
    if (remaining === 0) {
      await prisma.content.updateMany({
        where: { id: slot.contentId, ownerId, status: 'scheduled' },
        data: { status: 'draft' },
      });
    }
  }

  await logAudit({
    actor: ownerId,
    action: AUDIT_ACTIONS.SCHEDULE_DELETE,
    targetType: 'schedule_slot',
    targetId: slotId,
    payload: { cancelled: true },
  });

  return NextResponse.json({ data: { cancelled: true }, error: null });
}
