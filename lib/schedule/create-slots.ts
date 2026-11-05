// lib/schedule/create-slots.ts
// 스케줄 슬롯 멱등 생성 (POST /api/schedule/slots). 같은 owner·콘텐츠(또는 null)·채널·시각의
// 'scheduled' 슬롯이 이미 있거나 같은 요청 안에서 반복되면 건너뛴다(자동편성 재실행·취소 후 재적용·중복 클릭).
// 같은 owner 의 동시 요청은 트랜잭션 advisory lock 으로 직렬화해 검사-생성 경쟁(둘 다 통과)을 막는다.
// DB 유니크 제약 없이(스키마 변경 없이) 성립하는 방식 — 다른 상태(published 등) 슬롯은 중복 검사 대상이 아니다.
import type { Prisma, PrismaClient, ScheduleSlot } from '@prisma/client';

export interface SlotInput {
  contentId: string | null;
  channel: string;
  scheduledAt: Date;
  status: string;
  mode: string;
}

type Db = Pick<PrismaClient, '$transaction'>;

const keyOf = (r: { contentId: string | null; channel: string; scheduledAt: Date }) =>
  `${r.contentId ?? ''}|${r.channel}|${r.scheduledAt.getTime()}`;

/** 중복 제거 계획 (순수) — existing = DB 의 같은 시각 'scheduled' 슬롯 */
export function planSlotInserts(inputs: SlotInput[], existing: Array<{ contentId: string | null; channel: string; scheduledAt: Date }>) {
  const seen = new Set(existing.map(keyOf));
  const toCreate = inputs.filter((r) => {
    if (r.status !== 'scheduled') return true;
    const k = keyOf(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { toCreate, skipped: inputs.length - toCreate.length };
}

export async function createSlotsIdempotent(db: Db, ownerId: string, inputs: SlotInput[]): Promise<{ created: ScheduleSlot[]; skipped: number }> {
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`schedule_slots:${ownerId}`}, 0))`;
    const times = [...new Set(inputs.filter((r) => r.status === 'scheduled').map((r) => r.scheduledAt.getTime()))];
    const existing = times.length === 0 ? [] : await tx.scheduleSlot.findMany({
      where: { ownerId, status: 'scheduled', scheduledAt: { in: times.map((t) => new Date(t)) } },
      select: { contentId: true, channel: true, scheduledAt: true },
    });
    const { toCreate, skipped } = planSlotInserts(inputs, existing);
    // 단일 INSERT (최대 100건 — 행마다 왕복하면 트랜잭션 시간 제한에 걸린다)
    const created = toCreate.length === 0 ? [] : await tx.scheduleSlot.createManyAndReturn({
      data: toCreate.map((r) => ({ ownerId, ...r })),
    });
    return { created, skipped };
  });
}
