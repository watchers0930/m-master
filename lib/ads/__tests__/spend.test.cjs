/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, console */
// todayCostKrw: 같은 캠페인 행이 여럿이면 합산한다, id를 실은 요청에 유효한 빈 응답(data:[])은 spend_unknown(fail-closed),
// 비어 있지 않은 유효 응답에서 빠진 캠페인은 0원(기존 판정 유지). 가짜 클라이언트 훅은 기록만 한다(단언은 본문에서).
require('../../visibility/__tests__/register.cjs');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const trap = new Proxy({}, { get: () => new Proxy({}, { get: () => async () => { throw new Error('db touched'); } }) });
require.cache[require.resolve('../../auth.ts')] = { exports: { requireSession: async () => { throw new Error('Unauthorized'); } } };
require.cache[require.resolve('../../prisma.ts')] = { exports: { prisma: trap } };
const { todayCostKrw, STATS_ID_CHUNK } = require('../spend.ts');

const cmp = (n) => `cmp-a001-01-${String(n).padStart(9, '0')}`;
let campaigns = [], statsReplies = [];
const calls = [];
const client = { get: async (p, query) => {
  calls.push({ p, query });
  if (p === '/ncc/campaigns') return query.baseSearchId ? [] : campaigns.map((id) => ({ nccCampaignId: id, userLock: false, status: 'ELIGIBLE' }));
  return statsReplies.shift();
} };
const account = { id: 'acc1' };
let logs = [];
const quiet = async (fn) => { const o = console.error; console.error = (...a) => logs.push(a); try { return await fn(); } finally { console.error = o; } };
const outcome = (p) => quiet(() => p().then((v) => v, (e) => e.code ?? e.message));
beforeEach(() => { campaigns = []; statsReplies = []; calls.length = 0; logs = []; });

test('duplicate rows for the same campaign are summed (60,000 + 1 = 60,001)', async () => {
  campaigns = [cmp(1), cmp(2)];
  statsReplies = [{ data: [{ id: cmp(1), salesAmt: 60000 }, { id: cmp(2), salesAmt: 5 }, { id: cmp(1), salesAmt: 1 }] }];
  assert.equal(await outcome(() => todayCostKrw(account, client)), 60006);
  campaigns = [cmp(1)];
  statsReplies = [{ data: [{ id: cmp(1), salesAmt: 60000 }, { id: cmp(1), salesAmt: 1 }] }];
  assert.equal(await outcome(() => todayCostKrw(account, client)), 60001);
});

test('a valid empty data array for a request that carried ids is spend_unknown, not 0', async () => {
  campaigns = [cmp(1), cmp(2)];
  statsReplies = [{ data: [] }];
  assert.equal(await outcome(() => todayCostKrw(account, client)), 'spend_unknown');
  assert.deepEqual(logs, [['[ads] today spend unknown', { accountId: 'acc1', reason: 'stats_empty' }]]);
});

test('an empty reply on any later chunk is spend_unknown even if earlier chunks had rows', async () => {
  campaigns = Array.from({ length: STATS_ID_CHUNK + 1 }, (_, i) => cmp(i + 1));
  statsReplies = [{ data: [{ id: cmp(1), salesAmt: 100 }] }, { data: [] }];
  assert.equal(await outcome(() => todayCostKrw(account, client)), 'spend_unknown');
  assert.equal(calls.filter((c) => c.p === '/stats').length, 2);
});

test('a campaign missing from a NON-empty valid reply still counts as 0; no campaigns means no /stats call and 0', async () => {
  campaigns = [cmp(1), cmp(2), cmp(3)];
  statsReplies = [{ data: [{ id: cmp(2), salesAmt: 700 }] }];
  assert.equal(await outcome(() => todayCostKrw(account, client)), 700);
  campaigns = []; calls.length = 0;
  assert.equal(await outcome(() => todayCostKrw(account, client)), 0);
  assert.equal(calls.filter((c) => c.p === '/stats').length, 0);
});

test('rows for ids that were not requested are ignored (not added to the total)', async () => {
  campaigns = [cmp(1)];
  statsReplies = [{ data: [{ id: cmp(1), salesAmt: 10 }, { id: cmp(99), salesAmt: 90000 }] }];
  assert.equal(await outcome(() => todayCostKrw(account, client)), 10);
});
