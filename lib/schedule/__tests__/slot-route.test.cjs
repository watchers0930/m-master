/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, Request, __filename */
// /api/schedule/slot/[id] — CUID id 허용·소유권은 slot.ownerId·contentId=null 슬롯 처리·상태 조건부 갱신
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test'), assert = require('node:assert/strict');
let slots, contentWrites, remaining, activeClaims = 0;
require.cache[require.resolve('../../auth.ts')] = { exports: { requireSession: async () => ({ user: { id: 'owner' } }) } };
require.cache[require.resolve('../../audit/logger.ts')] = { exports: { logAudit: async () => {}, AUDIT_ACTIONS: { SCHEDULE_UPDATE: 'u', SCHEDULE_DELETE: 'd' } } };
const match = (s, where) => s.id === where.id && s.ownerId === where.ownerId
  && (typeof where.status === 'string' ? s.status === where.status : where.status?.in ? where.status.in.includes(s.status) : true);
require.cache[require.resolve('../../prisma.ts')] = { exports: { prisma: {
  scheduleSlot: {
    findFirst: async ({ where }) => slots.find((s) => s.id === where.id && s.ownerId === where.ownerId) ?? null,
    updateMany: async ({ where, data }) => { const hit = slots.filter((s) => match(s, where)); hit.forEach((s) => Object.assign(s, data)); return { count: hit.length }; },
    count: async () => remaining,
  },
  content: { updateMany: async (args) => { contentWrites.push(args); return { count: 1 }; } },
  // lib/schedule/slot-mutation.ts 의 잠금 경로 대역: SELECT … FOR UPDATE(slotId, ownerId) + 활성 claim 수 + 갱신
  $transaction: async (fn) => fn({
    $queryRaw: async (_sql, slotId, ownerId) => slots.filter((s) => s.id === slotId && s.ownerId === ownerId)
      .map((s) => ({ id: s.id, status: s.status, content_id: s.contentId, channel: 'facebook' })),
    publishClaim: { count: async () => activeClaims },
    scheduleSlot: { updateMany: async ({ where, data }) => { const hit = slots.filter((s) => s.id === where.id && s.ownerId === where.ownerId); hit.forEach((s) => Object.assign(s, data)); return { count: hit.length }; } },
  }),
} } };
const { createRequire } = require('node:module');
const route = createRequire(__filename)('../../../app/api/schedule/slot/[id]/route.ts');
const p = (id) => ({ params: Promise.resolve({ id }) });
const req = (method, body) => new Request('https://app.test/api/schedule/slot/x', { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
const CUID = 'clx0000000000000000000001';
const reset = () => { contentWrites = []; remaining = 0; activeClaims = 0; slots = [
  { id: CUID, ownerId: 'owner', status: 'scheduled', contentId: null },
  { id: 'clxwithcontent00000000001', ownerId: 'owner', status: 'scheduled', contentId: 'c1' },
  { id: 'clxforeign000000000000001', ownerId: 'foreign', status: 'scheduled', contentId: null },
  { id: 'clxpublished0000000000001', ownerId: 'owner', status: 'published', contentId: null },
]; };

test('CUID slot id is accepted; malformed id is rejected before DB', async () => {
  reset();
  assert.equal((await route.DELETE(req('DELETE'), p('bad id/../x'))).status, 400);
  assert.equal((await route.DELETE(req('DELETE'), p(CUID))).status, 200);
  assert.equal(slots[0].status, 'cancelled');
  assert.equal(contentWrites.length, 0, 'contentId=null 슬롯은 콘텐츠 복원을 건너뛴다');
});

test('ownership comes from slot.ownerId (foreign → 404), published → 409, cancelled is idempotent', async () => {
  reset();
  assert.equal((await route.DELETE(req('DELETE'), p('clxforeign000000000000001'))).status, 404);
  assert.equal((await route.DELETE(req('DELETE'), p('clxpublished0000000000001'))).status, 409);
  slots[0].status = 'cancelled';
  assert.equal((await route.DELETE(req('DELETE'), p(CUID))).status, 200);
});

test('content restored to draft only when no other active slot remains, scoped to owner', async () => {
  reset(); remaining = 1;
  assert.equal((await route.DELETE(req('DELETE'), p('clxwithcontent00000000001'))).status, 200);
  assert.equal(contentWrites.length, 0);
  reset(); remaining = 0;
  assert.equal((await route.DELETE(req('DELETE'), p('clxwithcontent00000000001'))).status, 200);
  assert.equal(contentWrites[0].where.ownerId, 'owner');
});

test('PATCH works for contentId=null slot and is conditional on scheduled status', async () => {
  reset();
  const future = new Date(Date.now() + 86400000).toISOString();
  assert.equal((await route.PATCH(req('PATCH', { scheduled_at: future }), p(CUID))).status, 200);
  assert.equal((await route.PATCH(req('PATCH', { scheduled_at: future }), p('clxpublished0000000000001'))).status, 409);
});

test('entityId accepts CUID and UUID, rejects unsafe characters', () => {
  const { entityId } = require('../../../schemas/id.ts');
  assert.equal(entityId.safeParse(CUID).success, true);
  assert.equal(entityId.safeParse('550e8400-e29b-41d4-a716-446655440000').success, true);
  for (const bad of ['', 'a b', 'a/b', '../x', 'x'.repeat(65)]) assert.equal(entityId.safeParse(bad).success, false);
});

test('발행 진행 중(활성 claim) 슬롯은 수정·취소 409, 슬롯은 그대로', async () => {
  reset(); activeClaims = 1;
  const res = await route.DELETE(req('DELETE'), p('clxwithcontent00000000001'));
  assert.equal(res.status, 409);
  assert.equal(slots[1].status, 'scheduled');
  const res2 = await route.PATCH(req('PATCH', { scheduled_at: new Date(Date.now() + 3600000).toISOString() }), p('clxwithcontent00000000001'));
  assert.equal(res2.status, 409);
});
