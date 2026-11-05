/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require */
// 스케줄 슬롯 멱등 생성 — 자동편성 재실행·취소 후 재적용이 같은 슬롯을 중복 생성하지 않는다 (교차검수 회귀 방지).
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSlotsIdempotent, planSlotInserts } = require('../create-slots.ts');

function fakeDb() {
  const rows = [];
  let locks = 0, chain = Promise.resolve();
  const tx = {
    $executeRaw: async () => { locks++; return 1; },
    scheduleSlot: {
      findMany: async ({ where }) => rows.filter(r => r.ownerId === where.ownerId && r.status === where.status
        && where.scheduledAt.in.some(d => d.getTime() === r.scheduledAt.getTime())),
      createManyAndReturn: async ({ data }) => { const out = data.map((d, i) => ({ id: `s${rows.length + i}`, ...d })); rows.push(...out); return out; },
    },
  };
  // 트랜잭션 직렬화(advisory lock 효과) 모사
  const db = { $transaction: (fn) => { const run = chain.then(() => fn(tx)); chain = run.catch(() => {}); return run; } };
  return { db, rows, locks: () => locks };
}

const at = (iso) => new Date(iso);
const P = (date, channel = 'blog') => ({ contentId: null, channel, scheduledAt: at(`${date}T09:00:00Z`), status: 'scheduled', mode: 'ai_auto' });

test('같은 제안 재적용 → 두 번째는 전부 skip', async () => {
  const { db, rows } = fakeDb();
  const proposals = [P('2027-01-04'), P('2027-01-04', 'instagram'), P('2027-01-11')];
  const a = await createSlotsIdempotent(db, 'o1', proposals);
  const b = await createSlotsIdempotent(db, 'o1', proposals);
  assert.equal(a.created.length, 3);
  assert.deepEqual([b.created.length, b.skipped], [0, 3]);
  assert.equal(rows.length, 3);
});

test('동시 요청(취소 후 즉시 재적용) → 중복 없음', async () => {
  const { db, rows, locks } = fakeDb();
  const proposals = [P('2027-02-01'), P('2027-02-08')];
  const [a, b] = await Promise.all([createSlotsIdempotent(db, 'o1', proposals), createSlotsIdempotent(db, 'o1', proposals)]);
  assert.equal(a.created.length + b.created.length, 2);
  assert.equal(rows.length, 2);
  assert.equal(locks(), 2);
});

test('요청 안 중복 제거 · 다른 owner·다른 시각·다른 콘텐츠는 별개', async () => {
  const { db, rows } = fakeDb();
  await createSlotsIdempotent(db, 'o1', [P('2027-03-01'), P('2027-03-01')]);
  await createSlotsIdempotent(db, 'o2', [P('2027-03-01')]);
  await createSlotsIdempotent(db, 'o1', [{ ...P('2027-03-01'), contentId: 'c1' }, { ...P('2027-03-01'), scheduledAt: at('2027-03-01T10:00:00Z') }]);
  assert.equal(rows.length, 4);
});

test('scheduled 아닌 슬롯은 중복 검사 대상 아님', () => {
  const r = planSlotInserts([{ ...P('2027-04-01'), status: 'published' }], [{ contentId: null, channel: 'blog', scheduledAt: at('2027-04-01T09:00:00Z') }]);
  assert.equal(r.toCreate.length, 1);
});
