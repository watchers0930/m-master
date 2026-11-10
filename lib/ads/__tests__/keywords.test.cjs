/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, Response, URL */
// 네이버 키워드 도구 리서치: 힌트 5개 배치·씨앗 정제·"< 10" 정규화·특수문자 제외·중복 제거·정렬·상위 200·형태 오류·배치 실패 전파.
// 가짜 transport만 쓴다(실제 네이버 호출 없음). transport 훅은 기록만 한다 — 단언은 훅 밖에서(클라이언트가 훅 예외를 삼킨다).
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
// 리서치는 DB·세션을 쓰지 않는다: 닿으면 기록하고 throw하는 함정(단언은 테스트 끝에서 기록으로)
const touched = [];
const trap = new Proxy({}, { get: (_, key) => { touched.push(String(key)); throw new Error(`unexpected prisma.${String(key)}`); } });
require.cache[require.resolve('../../prisma.ts')] = { exports: { prisma: trap } };
require.cache[require.resolve('../../auth.ts')] = { exports: { requireSession: async () => { touched.push('session'); throw new Error('unexpected session'); } } };
const { after } = require('node:test');
after(() => assert.deepEqual(touched, [], 'research must not touch the database or session'));
const { NaverAdsClient, NaverAdsError } = require('../../external/naver-searchad.ts');
const { researchKeywords, sanitizeSeeds } = require('../keywords.ts');

const CREDS = { customerId: '1234567', apiKey: 'TEST-apikey', secretKey: 'TEST-secret' };
const json = (status, body) => new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// respond(hints[]) → Response. 호출은 calls에 기록만 한다.
function fakeTool(respond) {
  const calls = [];
  const transport = async (url, init) => {
    const u = new URL(String(url));
    const call = { method: init.method, path: u.pathname, query: Object.fromEntries(u.searchParams) };
    calls.push(call);
    return respond((call.query.hintKeywords ?? '').split(','), calls.length);
  };
  return { client: new NaverAdsClient(CREDS, transport), calls };
}
const row = (relKeyword, pc, mobile, extra = {}) => ({
  relKeyword, monthlyPcQcCnt: pc, monthlyMobileQcCnt: mobile, monthlyAvePcClkCnt: 1.5, monthlyAveMobileClkCnt: 2.5,
  monthlyAvePcCtr: 0.5, monthlyAveMobileCtr: 1.2, plAvgDepth: 15, compIdx: '중간', ...extra,
});

test('sanitizeSeeds trims, removes spaces, drops invalid and dedupes case-insensitively in order', () => {
  const out = sanitizeSeeds(['  전세 사기  ', 'Vestra', 'vestra', '전세사기', '', '   ', 'a'.repeat(41), 'a'.repeat(40),
    '키워드!', 'naver.com', '부동산\t\n앱', 'AB 12', 7, null, '가']);
  assert.deepEqual(out, ['전세사기', 'Vestra', 'a'.repeat(40), '부동산앱', 'AB12', '가']);
});

test('batches hints by five', async () => {
  const seeds = Array.from({ length: 12 }, (_, i) => `씨앗${i + 1}`);
  const { client, calls } = fakeTool(() => json(200, { keywordList: [] }));
  const out = await researchKeywords(client, [...seeds, '씨앗 1', '씨앗3']);
  assert.deepEqual(out, []);
  assert.equal(calls.length, 3);
  for (const c of calls) {
    assert.equal(c.method, 'GET');
    assert.equal(c.path, '/keywordstool');
    assert.equal(c.query.showDetail, '1');
    assert.deepEqual(Object.keys(c.query).sort(), ['hintKeywords', 'showDetail']);
  }
  assert.deepEqual(calls.map((c) => c.query.hintKeywords), [
    '씨앗1,씨앗2,씨앗3,씨앗4,씨앗5', '씨앗6,씨앗7,씨앗8,씨앗9,씨앗10', '씨앗11,씨앗12',
  ]);
});

test('research seeds are capped at 25 (5 calls at most)', async () => {
  const { client, calls } = fakeTool(() => json(200, { keywordList: [] }));
  await researchKeywords(client, Array.from({ length: 40 }, (_, i) => `k${i}`));
  assert.equal(calls.length, 5);
  assert.equal(calls.at(-1).query.hintKeywords, 'k20,k21,k22,k23,k24');
});

test('normalizes lt10 and drops invalid keywords', async () => {
  const { client } = fakeTool((hints) => json(200, { keywordList: hints[0] === 'a' ? [
    row('전세사기', '< 10', 30, { compIdx: '높음' }),
    row('전세 보증금', 1200, 3400, { compIdx: 'low' }),
    row('반환보증', '<10', '< 10', { compIdx: 'mid' }),
    row('이상한값', 'abc', '-5', { compIdx: 'weird', monthlyAvePcCtr: '0.5', plAvgDepth: null }),
    row('', 100, 100), row('   ', 100, 100), row('키워드!', 999, 999), row('a/b', 999, 999), row('#태그', 999, 999),
    row('Vestra', 50, -1, { compIdx: 'high' }),
  ] : [row('전세사기', 5000, 5000), row('vestra', 9999, 9999), row(' 전세  보증금 ', 1, 1)] }));
  const out = await researchKeywords(client, ['a', 'a2', 'a3', 'a4', 'a5', 'b']); // 두 번째 배치는 같은 키워드를 다시 준다(먼저 본 것 유지)
  assert.deepEqual(out.map((k) => k.keyword), ['전세 보증금', 'Vestra', '전세사기', '반환보증', '이상한값']);
  const by = Object.fromEntries(out.map((k) => [k.keyword, k]));
  assert.deepEqual(by['전세사기'], { keyword: '전세사기', pcQc: null, mobileQc: 30, lt10: true, compIdx: '높음', pcCtr: 0.5, mobileCtr: 1.2, plAvgDepth: 15 });
  assert.deepEqual(by['반환보증'], { keyword: '반환보증', pcQc: null, mobileQc: null, lt10: true, compIdx: '중간', pcCtr: 0.5, mobileCtr: 1.2, plAvgDepth: 15 });
  assert.deepEqual(by['이상한값'], { keyword: '이상한값', pcQc: null, mobileQc: null, lt10: false, compIdx: null, pcCtr: null, mobileCtr: 1.2, plAvgDepth: null });
  assert.equal(by['전세 보증금'].compIdx, '낮음');
  assert.equal(by['전세 보증금'].pcQc, 1200);
  assert.deepEqual([by.Vestra.pcQc, by.Vestra.mobileQc, by.Vestra.compIdx], [50, null, '높음']);
});

test('keywords are sorted by total volume (lt10 as 0) then keyword, capped at 200', async () => {
  const many = Array.from({ length: 260 }, (_, i) => row(`kw${String(i).padStart(3, '0')}`, i % 7 === 0 ? '< 10' : i, 10));
  const { client } = fakeTool(() => json(200, { keywordList: [...many, row('동률b', 100, 0), row('동률a', 0, 100)] }));
  const out = await researchKeywords(client, ['seed']);
  assert.equal(out.length, 200);
  const total = (k) => (k.pcQc ?? 0) + (k.mobileQc ?? 0);
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1], b = out[i];
    assert.ok(total(a) > total(b) || (total(a) === total(b) && a.keyword < b.keyword), `${a.keyword} before ${b.keyword}`);
  }
  assert.equal(out[0].keyword, 'kw258'); // 259는 7의 배수 → "< 10"
  const iA = out.findIndex((k) => k.keyword === '동률a'), iB = out.findIndex((k) => k.keyword === '동률b');
  assert.ok(iA >= 0 && iA + 1 === iB, 'equal totals tie-break by keyword');
});

test('empty keywordList returns empty', async () => {
  for (const body of [{ keywordList: [] }, []]) {
    const { client, calls } = fakeTool(() => json(200, body));
    assert.deepEqual(await researchKeywords(client, ['전세']), []);
    assert.equal(calls.length, 1);
  }
  const { client, calls } = fakeTool(() => json(200, { keywordList: [] }));
  assert.deepEqual(await researchKeywords(client, ['', '!!', '  ']), []);
  assert.equal(calls.length, 0, 'no valid seed → no Naver call');
});

test('both response shapes are parsed: wrapped and top-level array', async () => {
  const rows = [row('전세사기', 100, 200), row('반환보증', '< 10', 5)];
  const expected = ['전세사기', '반환보증'];
  for (const body of [{ keywordList: rows }, rows]) {
    const { client } = fakeTool(() => json(200, body));
    const out = await researchKeywords(client, ['전세']);
    assert.deepEqual(out.map((k) => k.keyword), expected);
    assert.deepEqual([out[1].pcQc, out[1].mobileQc, out[1].lt10], [null, 5, true]);
  }
});

test('malformed success body is an error, not an empty result', async () => {
  // 컨트롤러 판정: 감싼 형태·최상위 배열만 허용. {}·null·빈 본문·{keywordList:null}·목록 아닌 값은 오류
  for (const body of [{}, null, { keywordList: 'x' }, { keywordList: null }, { keywordList: [{ monthlyPcQcCnt: 1 }] }, [{ monthlyPcQcCnt: 1 }], 'x', 7, undefined]) {
    const { client } = fakeTool(() => json(200, body));
    await assert.rejects(researchKeywords(client, ['전세']), (e) => e.code === 'ads_unexpected_response' && e.status === 502);
  }
});

test('a failing batch propagates its NaverAdsError (no partial result)', async () => {
  const { client, calls } = fakeTool((hints, n) => (n === 2 ? json(400, { code: 11001, title: 'bad hint' }) : json(200, { keywordList: [row(hints[0], 10, 10)] })));
  await assert.rejects(researchKeywords(client, ['a1', 'a2', 'a3', 'a4', 'a5', 'b1', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6']),
    (e) => e instanceof NaverAdsError && e.reason === 'ads_rejected' && e.naverCode === 11001);
  assert.equal(calls.length, 2, 'stops at the failed batch; later batches are not sent');
});
