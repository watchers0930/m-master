/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, Response, AbortController */
// 네이버 클라이언트 호출 예산(Task 11 fix round 2 판정 (b)): 감시는 남은 예산 함수(budget: () => ms)를 넘긴다.
// - 남은 예산 ≤ 0이면 호출을 시작하지 않는다(네트워크 0, ads_unavailable — 보내지 않았으므로 변이도 uncertain 아님).
// - 호출 마감 = min(45초, 남은 예산). 시도별 타임아웃도 그 안. GET 재시도도 같은 마감 안에서만.
// - budget을 넘기지 않으면 기존 동작 그대로(Task 3).
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
require.cache[require.resolve('../../prisma.ts')] = { exports: { prisma: new Proxy({}, { get: () => { throw new Error('db must not be touched'); } }) } };
const { NaverAdsClient, NaverAdsError } = require('../../external/naver-searchad.ts');

const CREDS = { customerId: '1234567', apiKey: 'TEST-apikey-0000000001', secretKey: 'TEST-secret-0000000001' };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function clock() {
  const c = { t: 1731200000000, timeouts: [] };
  c.now = () => c.t;
  c.sleep = async (ms) => { c.t += ms; };
  c.timeout = (ms) => { c.timeouts.push(ms); return new AbortController().signal; };
  return c;
}

test('budget <= 0 → no call starts (GET and PUT), reason ads_unavailable', async () => {
  for (const left of [0, -5]) {
    let calls = 0;
    const client = new NaverAdsClient(CREDS, async () => { calls++; return json(200, []); }, clock(), () => left);
    await assert.rejects(client.get('/ncc/campaigns'), (e) => e instanceof NaverAdsError && e.reason === 'ads_unavailable');
    await assert.rejects(client.put('/ncc/campaigns/cmp-1', { nccCampaignId: 'cmp-1', userLock: true }, { fields: 'userLock' }), (e) => e instanceof NaverAdsError && e.reason === 'ads_unavailable');
    assert.equal(calls, 0, '네트워크 0');
  }
});

test('per-call deadline = min(45s, budget); timeouts and GET retries stay inside it', async () => {
  const c = clock();
  const start = c.t;
  const starts = [];
  const client = new NaverAdsClient(CREDS, async () => { starts.push(c.t - start); c.t += 400; return json(503, {}); }, c, () => 1000);
  await assert.rejects(client.get('/stats'), (e) => e.reason === 'ads_unavailable');
  assert.ok(c.timeouts.every((ms) => ms <= 1000), `시도별 타임아웃 ≤ 예산: ${c.timeouts}`);
  assert.ok(starts.every((ms) => ms < 1000), `재시도도 예산 안에서만 시작: ${starts}`);
  assert.ok(c.t - start <= 1000 + 400, '마감 뒤에는 새 시도를 하지 않는다');
  const c2 = clock();
  const big = new NaverAdsClient(CREDS, async () => json(200, []), c2, () => 10 * 60_000);
  await big.get('/ncc/campaigns');
  assert.ok(c2.timeouts[0] <= 25_000, '예산이 커도 시도 상한 25초·호출 상한 45초 그대로');
  const c3 = clock();
  await new NaverAdsClient(CREDS, async () => json(200, []), c3).get('/ncc/campaigns');
  assert.equal(c3.timeouts[0], 25_000, 'budget 없음 = 기존 동작');
});
