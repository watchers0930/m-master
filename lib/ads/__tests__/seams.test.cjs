/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 테스트 이음새(deps.afterLock)는 production에서 거부된다 — 적용·잠금·제안 편집·결정 모두 같은 가드(DB·네이버 접근 0).
require('../../visibility/__tests__/register.cjs');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const touched = [];
// DB에 닿으면 기록만 하고 실패시킨다(단언은 바깥에서)
const trap = new Proxy({}, { get: (_t, model) => (model === 'then' ? undefined : new Proxy(async () => { touched.push(String(model)); throw new Error('db touched'); }, {
  get: (_m, op) => async () => { touched.push(`${String(model)}.${String(op)}`); throw new Error('db touched'); },
})) });
require.cache[require.resolve('../../auth.ts')] = { exports: { requireSession: async () => ({ user: { id: 'owner' } }) } };
require.cache[require.resolve('../../prisma.ts')] = { exports: { prisma: trap } };
const { applyProposal } = require('../apply.ts');
const { setLock } = require('../locks.ts');
const { editProposal, reviewProposal } = require('../proposal-review.ts');

const ID = 'ckproposal0000000000000001';
const STAMP = '2026-11-10T00:00:00.000Z';
const seam = async () => {};
const calls = () => [
  ['applyProposal', () => applyProposal('owner', ID, { afterLock: seam })],
  ['setLock', () => setLock('owner', { type: 'campaign', id: ID }, true, 0, { afterLock: seam })],
  ['editProposal', () => editProposal('owner', ID, { expected_updated_at: STAMP, payload: {} }, { afterLock: seam })],
  ['reviewProposal', () => reviewProposal('owner', ID, { decision: 'reject', expected_updated_at: STAMP }, { afterLock: seam })],
];
let savedEnv;
beforeEach(() => { savedEnv = process.env.NODE_ENV; process.env.ADS_OWNER_IDS = 'owner'; process.env.ADS_EXECUTION_ENABLED = 'true'; touched.length = 0; });
afterEach(() => { process.env.NODE_ENV = savedEnv; delete process.env.ADS_EXECUTION_ENABLED; });

test('afterLock seam is refused in production before any DB access', async () => {
  process.env.NODE_ENV = 'production';
  const outcomes = [];
  for (const [name, call] of calls()) outcomes.push([name, await call().then(() => 'resolved', (e) => e.message)]);
  assert.deepEqual(outcomes, calls().map(([name]) => [name, 'test_seam_forbidden']));
  assert.deepEqual(touched, []);
});

test('outside production the seam is allowed through to the DB (guard is env-scoped, not a blanket refusal)', async () => {
  process.env.NODE_ENV = 'test';
  for (const [name, call] of calls()) assert.notEqual(await call().then(() => 'resolved', (e) => e.message), 'test_seam_forbidden', name);
  assert.ok(touched.length > 0);
});
