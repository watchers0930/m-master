/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, setImmediate */
// 순위별 예상 입찰가(B4) — lib/ads/estimate.ts. 실제 서명 클라이언트(NaverAdsClient) + 가짜 네이버(메모리). 실제 네트워크·키 없음.
// 가짜 훅은 기록·응답 교체만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
// lib/ads/http.ts → visibility/http → lib/auth(next-auth)를 끊는다 — 이 테스트는 라우트·세션을 쓰지 않는다
require.cache[require.resolve('../../auth.ts')] = { exports: { requireSession: async () => { throw new Error('no session in unit test'); } } };
const { fakeNaver, json } = require('./fixtures/fake-naver.cjs');
const { NaverAdsClient } = require('../../external/naver-searchad.ts');
const { estimatePositionBids, expectedPosition, ESTIMATE_PATHS, MAX_ESTIMATE_ITEMS } = require('../estimate.ts');

const CREDS = { customerId: '1234567', apiKey: 'k'.repeat(20), secretKey: 's'.repeat(20) };
const PATH = '/estimate/average-position-bid/keyword';
const ladder = (base) => ({ 1: base + 400, 2: base + 300, 3: base + 200, 4: base + 100, 5: base });
function setup() {
  const naver = fakeNaver();
  naver.state.keys.set(CREDS.customerId, { apiKey: CREDS.apiKey, secretKey: CREDS.secretKey });
  return { naver, client: new NaverAdsClient(CREDS, naver.fn) };
}
const plain = (map) => Object.fromEntries([...map].map(([k, v]) => [k, v]));

test('allowlist is exactly the official average-position-bid path', () => {
  assert.deepEqual([...ESTIMATE_PATHS], [PATH]);
  assert.equal(MAX_ESTIMATE_ITEMS, 25);
});

test('(a) request body matches the official spec: { device, items: [{ key, position }] }, one POST per device, positions 1..5', async () => {
  const { naver, client } = setup();
  naver.state.positionBids.set('전세사기', { PC: ladder(500), MOBILE: ladder(700) });
  naver.state.positionBids.set('등기부등본', { PC: ladder(100), MOBILE: ladder(200) });
  const result = await estimatePositionBids(client, ['전세사기', '등기부등본', '전세사기']);
  assert.deepEqual(naver.state.calls.map((c) => [c.method, c.path]), [['POST', PATH], ['POST', PATH]]);
  assert.deepEqual(naver.state.calls.map((c) => c.body.device), ['PC', 'MOBILE']);
  for (const c of naver.state.calls) {
    assert.deepEqual(Object.keys(c.body).sort(), ['device', 'items']);
    assert.deepEqual(c.body.items, ['전세사기', '등기부등본'].flatMap((key) => [1, 2, 3, 4, 5].map((position) => ({ key, position }))));
    assert.deepEqual(c.query, {});
  }
  assert.deepEqual(plain(result), {
    전세사기: { PC: ladder(500), MOBILE: ladder(700) },
    등기부등본: { PC: ladder(100), MOBILE: ladder(200) },
  });
});

test('(b) more than 25 keyword×position items are sent in sequential batches of at most 25', async () => {
  const { naver, client } = setup();
  const keywords = Array.from({ length: 12 }, (_, i) => `키워드${i}`);
  for (const k of keywords) naver.state.positionBids.set(k, { PC: ladder(300), MOBILE: ladder(400) });
  let inflight = 0;
  const peaks = [];
  naver.state.hooks.before = async () => { inflight++; peaks.push(inflight); await new Promise((r) => setImmediate(r)); inflight--; };
  const result = await estimatePositionBids(client, keywords);
  assert.deepEqual(naver.state.calls.map((c) => [c.body.device, c.body.items.length]), [['PC', 25], ['PC', 25], ['PC', 10], ['MOBILE', 25], ['MOBILE', 25], ['MOBILE', 10]]);
  assert.equal(Math.max(...peaks), 1, '순차 호출');
  for (const device of ['PC', 'MOBILE']) {
    const sent = naver.state.calls.filter((c) => c.body.device === device).flatMap((c) => c.body.items.map((i) => `${i.key}#${i.position}`));
    assert.equal(new Set(sent).size, 60);
  }
  for (const k of keywords) assert.deepEqual(result.get(k), { PC: ladder(300), MOBILE: ladder(400) });
});

test('(c) malformed estimate items are skipped; the rest is kept and the call does not fail', async () => {
  const { naver, client } = setup();
  naver.state.hooks.after = (call) => (call.body.device === 'PC' ? json(200, { device: 'PC', estimate: [
    { keyword: '전세사기', position: 1, bid: 1350 },
    { keyword: '전세사기', position: 2, bid: '900' },
    { keyword: '전세사기', position: 3, bid: -10 },
    { keyword: '전세사기', position: 4, bid: 0 },
    { keyword: '전세사기', position: 9, bid: 100 },
    { keyword: '전세사기', position: 5, bid: 2.5 },
    { position: 2, bid: 800 },
    { keyword: '남의키워드', position: 1, bid: 999 },
    null, 'x', 42,
    { keyword: 'abc def', position: 2, bid: 640 },
    { keyword: '전세사기', position: 5, bid: 300, nccKeywordId: null },
  ] }) : json(200, { device: 'MOBILE', estimate: 'not a list' }));
  const result = await estimatePositionBids(client, ['전세사기', 'ABCDEF'], ['PC']);
  assert.deepEqual(plain(result), { 전세사기: { PC: { 1: 1350, 5: 300 }, MOBILE: {} }, ABCDEF: { PC: { 2: 640 }, MOBILE: {} } });
  // 바깥 형태가 틀리면(목록 아님) 판단하지 않고 502 형식 오류
  await assert.rejects(estimatePositionBids(client, ['전세사기'], ['MOBILE']), (e) => e.code === 'ads_unexpected_response' && e.status === 502);
});

test('an item for a keyword/position not asked in that batch is ignored', async () => {
  const { naver, client } = setup();
  const keywords = Array.from({ length: 6 }, (_, i) => `k${i}`); // 30항목 → 묶음 [k0..k4], [k5]
  for (const k of keywords) naver.state.positionBids.set(k, { PC: { 2: 500, 3: 400, 4: 300, 5: 200 } });
  naver.state.hooks.after = async (call, res) => {
    if (call.body.device !== 'PC' || !call.body.items.some((i) => i.key === 'k0')) return res;
    const body = await res.json();
    return json(200, { ...body, estimate: [...body.estimate, { keyword: 'k5', position: 1, bid: 1 }] }); // 다음 묶음 키워드를 끼워 넣음
  };
  const result = await estimatePositionBids(client, keywords, ['PC']);
  assert.deepEqual(result.get('k5').PC, { 2: 500, 3: 400, 4: 300, 5: 200 });
  assert.deepEqual(result.get('k0').PC, { 2: 500, 3: 400, 4: 300, 5: 200 });
});

test('two requested keywords that normalize to the same key: a loose echo is ambiguous and dropped, exact echoes still match', async () => {
  const { naver, client } = setup();
  naver.state.hooks.after = (call) => json(200, { device: call.body.device, estimate: [
    { keyword: 'ABC', position: 1, bid: 900 }, // 'ab c'와 'abc '가 모두 ABC — 어느 쪽인지 모른다
    { keyword: 'ab c', position: 2, bid: 700 },
    { keyword: 'abc ', position: 3, bid: 500 },
  ] });
  const result = await estimatePositionBids(client, ['ab c', 'abc '], ['PC']);
  assert.deepEqual(plain(result), { 'ab c': { PC: { 2: 700 }, MOBILE: {} }, 'abc ': { PC: { 3: 500 }, MOBILE: {} } });
});

test('Naver errors propagate once (no retry); a 5xx on this read is ads_unavailable, not ads_uncertain', async () => {
  const { naver, client } = setup();
  naver.state.hooks.before = () => json(403, { code: 1018, title: 'forbidden' });
  await assert.rejects(estimatePositionBids(client, ['전세사기']), (e) => e.name === 'NaverAdsError' && e.reason === 'ads_forbidden' && e.naverCode === 1018);
  assert.equal(naver.state.calls.length, 1);
  naver.state.calls.length = 0;
  naver.state.hooks.before = () => json(500, { code: 1016 });
  await assert.rejects(estimatePositionBids(client, ['전세사기']), (e) => e.name === 'NaverAdsError' && e.reason === 'ads_unavailable' && e.status === 500);
  assert.equal(naver.state.calls.length, 1);
});

test('no keywords → no Naver call; every call goes only to the allowlisted path', async () => {
  const { naver, client } = setup();
  assert.deepEqual(plain(await estimatePositionBids(client, [])), {});
  assert.equal(naver.state.calls.length, 0);
  await estimatePositionBids(client, Array.from({ length: 7 }, (_, i) => `k${i}`));
  assert.ok(naver.state.calls.length > 0);
  for (const c of naver.state.calls) assert.ok(ESTIMATE_PATHS.includes(c.path), c.path);
});

test('(d) expectedPosition: best position whose bid ≤ my bid, 6위 이하 below 5위, null when unknown', () => {
  const t = { 1: 1350, 2: 900, 3: 600, 4: 450, 5: 300 };
  assert.equal(expectedPosition(1350, t), 1, '정확히 같음 → 그 순위');
  assert.equal(expectedPosition(2000, t), 1);
  assert.equal(expectedPosition(900, t), 2);
  assert.equal(expectedPosition(899, t), 3, '사이 → 아래 순위');
  assert.equal(expectedPosition(300, t), 5);
  assert.equal(expectedPosition(299, t), '6위 이하');
  assert.equal(expectedPosition(70, t), '6위 이하');
  // 빠진 순위
  assert.equal(expectedPosition(1000, { 2: 900, 5: 300 }), 2, '1위 없음 → 다음 있는 순위');
  assert.equal(expectedPosition(500, { 1: 1350, 2: 900 }), null, '5위 값이 없으면 6위 이하라고 단정하지 않는다');
  assert.equal(expectedPosition(200, { 3: 600, 5: 300 }), '6위 이하');
  assert.equal(expectedPosition(500, {}), null);
});

test('(M-7) non-monotonic table: the best (smallest) p with table[p] ≤ bid wins, even if a worse position costs more', () => {
  const t = { 1: 1000, 2: 400, 3: 600, 4: 300, 5: 200 }; // 2위가 3위보다 싸다(네이버 추정 오차)
  assert.equal(expectedPosition(500, t), 2, '3위(600)를 못 넘어도 2위(400) ≤ 500 이면 2위');
  assert.equal(expectedPosition(350, t), 4);
  assert.equal(expectedPosition(1000, t), 1);
});
