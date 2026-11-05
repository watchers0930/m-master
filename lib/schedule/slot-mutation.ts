// lib/schedule/slot-mutation.ts — 슬롯 변경(시간 수정·취소)의 단일 경로.
// 발행 claim(lib/publish/claims.ts claimPublish)과 같은 슬롯 행을 FOR UPDATE 로 잠가 직렬화한다:
//  · claim 이 먼저면 → 활성 claim(claimed/unknown)이 보여 409 (이미 외부 전송 중이거나 게시됐을 수 있음)
//  · 변경이 먼저면 → claim 쪽이 잠금 후 재확인에서 scheduled/도래가 아니어서 발행하지 않음
import { prisma } from '@/lib/prisma';

export type SlotMutationResult = { ok: true; contentId: string | null } | { ok: false; reason: 'not_found' | 'status' | 'publishing'; status?: string };

export async function mutateIdleSlot(ownerId: string, slotId: string, allowed: string[], data: Record<string, unknown>): Promise<SlotMutationResult> {
  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ id: string; status: string; content_id: string | null; channel: string }[]>`
      SELECT id, status, content_id, channel FROM schedule_slots WHERE id = ${slotId} AND owner_id = ${ownerId} FOR UPDATE`;
    const slot = rows[0];
    if (!slot) return { ok: false, reason: 'not_found' } as const;
    if (!allowed.includes(slot.status)) return { ok: false, reason: 'status', status: slot.status } as const;
    if (slot.content_id) {
      const active = await tx.publishClaim.count({ where: { ownerId, targetType: 'content', targetId: slot.content_id,
        channel: slot.channel, status: { in: ['claimed', 'unknown'] } } });
      if (active) return { ok: false, reason: 'publishing' } as const;
    }
    await tx.scheduleSlot.updateMany({ where: { id: slotId, ownerId }, data });
    return { ok: true, contentId: slot.content_id } as const;
  });
}
