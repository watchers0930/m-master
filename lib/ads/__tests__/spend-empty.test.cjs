/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, console */
// todayCostKrw 빈 /stats 묶음(재검토 N2 — 빈 응답이 새 계정의 첫 켜기를 영원히 막지 않게):
// 빈 묶음(data:[])은 그 묶음의 모든 캠페인이 같은 실행의 완전한 목록에서 꺼져 있고(userLock 또는 DELETED) editTm < 오늘 KST 0시일 때만 0원.
// 하나라도 켜짐·오늘 수정·editTm 없음/파싱 불가·목록 불완전이면 spend_unknown. 가짜 클라이언트는 기록만 한다(단언은 본문에서).
require('../../visibility/__tests__/register.cjs');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const trap = new Proxy({}, { get: () => new Proxy({}, { get: () => async () => { throw new Error('db touched'); } }) });
require.cache[require.resolve('../../auth.ts')] = { exports: { requireSession: async () => { throw new Error('Unauthorized'); } } };
require.cache[require.resolve('../../prisma.ts')] = { exports: { prisma: trap } };
const { todayCostKrw, STATS_ID_CHUNK } = require('../spend.ts');

const NOW = new Date('2026-03-10T03:00:00Z'); // KST 2026-03-10 12:00, 오늘 0시 = 2026-03-09T15:00:00Z
const YESTERDAY = '2026-03-09T14:59:59.999Z'; // 오늘 0시 1ms 전
const TODAY_START = '2026-03-09T15:00:00Z';
const cmp = (n) => `cmp-a001-01-${String(n).padStart(9, '0')}`;
const off = (n, extra = {}) => ({ nccCampaignId: cmp(n), userLock: true, status: 'PAUSED', editTm: YESTERDAY, ...extra });
let campaigns = [], statsReplies = [], ignoreCursor = false;
const calls = [];
const client = { get: async (p, query) => {
  calls.push({ p, query });
  if (p === '/ncc/campaigns') return query.baseSearchId && !ignoreCursor ? [] : campaigns.map((c) => ({ ...c }));
  return statsReplies.shift();
} };
const account = { id: 'acc1' };
let logs = [];
const quiet = async (fn) => { const o = console.error; console.error = (...a) => logs.push(a); try { return await fn(); } finally { console.error = o; } };
const outcome = (p) => quiet(() => p().then((v) => v, (e) => e.code ?? e.message));
const cost = () => outcome(() => todayCostKrw(account, client, NOW));
beforeEach(() => { campaigns = []; statsReplies = []; calls.length = 0; logs = []; ignoreCursor = false; });

test('a brand-new account whose campaigns are all off since before today: an empty reply is 0', async () => {
  campaigns = [off(1), off(2, { userLock: false, status: 'DELETED' })];
  statsReplies = [{ data: [] }];
  assert.equal(await cost(), 0);
  assert.deepEqual(logs, [], 'spend_unknown 로그 없음');
  assert.equal(calls.filter((c) => c.p === '/stats').length, 1);
});

test('an off campaign edited today (at or after KST midnight) keeps the empty reply unknown', async () => {
  campaigns = [off(1), off(2, { editTm: TODAY_START })];
  statsReplies = [{ data: [] }];
  assert.equal(await cost(), 'spend_unknown');
  assert.deepEqual(logs, [['[ads] today spend unknown', { accountId: 'acc1', reason: 'stats_empty' }]]);
});

test('one campaign ON keeps the empty reply unknown', async () => {
  campaigns = [off(1), off(2, { userLock: false, status: 'ELIGIBLE' })];
  statsReplies = [{ data: [] }];
  assert.equal(await cost(), 'spend_unknown');
});

test('editTm missing, null, unparseable or of the wrong type keeps the empty reply unknown (and never breaks the list)', async () => {
  for (const editTm of [undefined, null, 'not-a-date', 12345, '']) {
    campaigns = [off(1), off(2, { editTm })];
    statsReplies = [{ data: [] }];
    logs = [];
    assert.equal(await cost(), 'spend_unknown', `editTm=${JSON.stringify(editTm)}`);
    assert.deepEqual(logs.map((l) => l[1].reason), ['stats_empty'], '목록 형식 오류가 아니라 빈 응답 판정');
  }
});

test('an incomplete campaign list stays unknown before any /stats call', async () => {
  ignoreCursor = true; // 커서 미지원 → 같은 페이지 반복 → complete=false
  campaigns = [off(1), off(2)];
  statsReplies = [{ data: [] }];
  assert.equal(await cost(), 'spend_unknown');
  assert.deepEqual(logs.map((l) => l[1].reason), ['campaign_list_incomplete']);
  assert.equal(calls.filter((c) => c.p === '/stats').length, 0);
});

test('chunks are judged separately: a quiet empty chunk is 0, a rowed chunk is summed, a lit empty chunk is unknown', async () => {
  campaigns = Array.from({ length: STATS_ID_CHUNK + 1 }, (_, i) => (i === 0 ? off(1, { userLock: false, status: 'ELIGIBLE' }) : off(i + 1)));
  statsReplies = [{ data: [{ id: cmp(1), salesAmt: 700 }] }, { data: [] }];
  assert.equal(await cost(), 700, '두 번째 묶음(전부 어제부터 꺼짐)은 0원');
  campaigns = Array.from({ length: STATS_ID_CHUNK + 1 }, (_, i) => (i === STATS_ID_CHUNK ? off(i + 1, { userLock: false, status: 'ELIGIBLE' }) : off(i + 1)));
  statsReplies = [{ data: [] }, { data: [] }];
  assert.equal(await cost(), 'spend_unknown', '켜진 캠페인이 든 빈 묶음은 모름');
});
