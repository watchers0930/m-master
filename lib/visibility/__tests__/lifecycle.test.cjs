/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require */
require('./register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Prisma } = require('@prisma/client');
require.cache[require.resolve('../../prisma.ts')] = { exports: { prisma: {} } };
require.cache[require.resolve('../track.ts')] = { exports: { capture: async () => [] } };
const { expireUnrecoverablePending, CAPTURE_LEASE_MS } = require('../pending.ts');
const { dueQueries } = require('../cron.ts');
const { periodRange } = require('../run-key.ts');

test('expiry releases only expired pending snapshots without task or checkpoint and scopes the owner', async () => {
  const now = new Date('2026-10-19T01:00:00Z');
  const rows = [
    { id: 'expired', ownerId: 'owner', status: 'pending', capturedAt: new Date(now - CAPTURE_LEASE_MS), taskId: null, rawJson: null },
    { id: 'active', ownerId: 'owner', status: 'pending', capturedAt: new Date(now - 1000), taskId: null, rawJson: null },
    { id: 'known', ownerId: 'owner', status: 'pending', capturedAt: new Date(now - 600000), taskId: 'paid', rawJson: null },
    { id: 'saved', ownerId: 'owner', status: 'pending', capturedAt: new Date(now - 600000), taskId: null, rawJson: { answerText: 'result' } },
    { id: 'foreign', ownerId: 'other', status: 'pending', capturedAt: new Date(now - 600000), taskId: null, rawJson: null },
    { id: 'complete', ownerId: 'owner', status: 'ok', capturedAt: new Date(now - 600000), taskId: null, rawJson: null },
  ];
  const db = { visibilitySnapshot: { updateMany: async ({ where, data }) => {
    assert.equal(where.rawJson.equals, Prisma.AnyNull);
    const matches = rows.filter(r => r.ownerId === where.query.ownerId && r.status === where.status && r.capturedAt <= where.capturedAt.lte && r.taskId === where.taskId && r.rawJson === null);
    matches.forEach(r => Object.assign(r, data));
    return { count: matches.length };
  } } };
  assert.equal((await expireUnrecoverablePending(db, 'owner', now)).count, 1);
  assert.equal(rows[0].status, 'failed');
  assert.equal(rows.slice(1).every(r => r.status !== 'failed'), true);
});
test('cron uses indexed time ranges with KST daily and weekly boundaries', () => {
  const now = new Date('2026-10-18T15:00:00Z');
  assert.deepEqual(periodRange('daily', now), { gte: now, lt: new Date('2026-10-19T15:00:00Z') });
  assert.deepEqual(periodRange('weekly', now), { gte: now, lt: new Date('2026-10-25T15:00:00Z') });
  const where = dueQueries(undefined, now);
  assert.equal(JSON.stringify(where).includes('endsWith'), false);
  assert.equal(where.OR.length, 3);
  for (const frequency of where.OR.slice(1)) {
    for (const engine of frequency.OR) {
      assert.deepEqual(engine.AND[0].snapshots.none.capturedAt, periodRange(frequency.frequency, now));
    }
  }
  assert.equal(dueQueries(undefined, new Date('2026-10-19T15:00:00Z')).OR.length, 2);
});
