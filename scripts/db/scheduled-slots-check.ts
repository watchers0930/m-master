// scripts/db/scheduled-slots-check.ts — 읽기 전용: 킬스위치(PIPELINE_AUTOMATION_ENABLED) 켜기 전, schedule-publish 가 집어갈
// 예약 슬롯(status=scheduled)과 그 글의 승인 상태를 확인한다(lib/pipeline/schedule-publish.ts 와 같은 조건). 쓰기 없음.
// 사용: npx tsx scripts/db/scheduled-slots-check.ts [ownerId]
import { config } from 'dotenv'; config({ path: '.env.local' });
(async () => {
  const { prisma } = await import('@/lib/prisma');
  const { MAX_SLOT_RETRIES } = await import('@/lib/pipeline/schedule-publish');
  const ownerId = process.argv[2] ?? 'cm_admin_001';
  const slots = await prisma.scheduleSlot.findMany({ where: { ownerId, status: 'scheduled' },
    select: { id: true, channel: true, scheduledAt: true, retryCount: true, contentId: true }, orderBy: { scheduledAt: 'asc' }, take: 200 });
  const ids = slots.map(s => s.contentId).filter((v): v is string => !!v);
  const contents = new Map((await prisma.content.findMany({ where: { id: { in: ids } }, select: { id: true, reviewStatus: true, status: true, topic: true } })).map(c => [c.id, c]));
  const now = Date.now();
  console.log(`예약 슬롯 ${slots.length}건 (재시도 한도 ${MAX_SLOT_RETRIES}회)`);
  console.table(slots.map(s => { const c = s.contentId ? contents.get(s.contentId) : undefined; return {
    슬롯: s.id, 채널: s.channel, 예약시각: s.scheduledAt.toISOString().slice(0, 16), 시점: s.scheduledAt.getTime() <= now ? '지남' : '미래',
    재시도: s.retryCount, 발행대상: s.scheduledAt.getTime() <= now && s.retryCount < MAX_SLOT_RETRIES ? '예' : '-',
    승인상태: ({ approved: '승인됨', pending_review: '검토 대기', rejected: '반려' } as Record<string, string>)[c?.reviewStatus ?? ''] ?? '(글 없음)',
    글상태: c?.status ?? '-', 주제: (c?.topic ?? '').slice(0, 30) }; }));
  await prisma.$disconnect();
})();
