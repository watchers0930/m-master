/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
// 요일 패턴 공용 집계 + 스케줄러 자동편성 계약 (교차검수 F1 회귀 방지).
// /api/analytics/ga4-pattern 응답 = { data: Ga4Block<DowChannelRow[]> } — 성공·실패 블록 모두 예외 없이 처리해야 한다.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { aggregateDowPattern } = require('../dow-pattern.ts');
const { autoSchedule } = require('../../api/schedule.ts');

const ROWS = [
  { dow: 1, channel: 'Organic Search', sessions: 120 },
  { dow: 2, channel: 'Direct', sessions: 80 },
  { dow: 3, channel: 'Organic Social', sessions: 40 },
  { dow: 5, channel: 'Paid Social', sessions: 30 },
  { dow: 9, channel: 'Organic Search', sessions: 999 }, // 범위 밖 요일 무시
  { dow: 4, channel: 'Unknown', sessions: 500 },        // 매핑 없는 채널 무시
];

function mockFetch(body, status = 200) {
  const calls = [];
  global.fetch = async (url) => { calls.push(String(url)); return { ok: status < 400, status, json: async () => body }; };
  return calls;
}

// 미래 달(과거 날짜 제외 로직에 걸리지 않게)
const Y = new Date().getFullYear() + 1;

test('aggregateDowPattern: 채널 매핑·행렬·상위 요일·합계', () => {
  const agg = aggregateDowPattern(ROWS);
  assert.deepEqual(agg.matrix.blog, [0, 120, 80, 0, 0, 0, 0]);
  assert.deepEqual(agg.pattern.blog, [1, 2]);
  assert.deepEqual(agg.pattern.instagram, [3]);
  assert.deepEqual(agg.pattern.facebook, [5]);
  assert.deepEqual(agg.totals, { blog: 200, instagram: 40, facebook: 30 });
});

test('autoSchedule: ok 블록 → 패턴 요일로 제안, 예외 없음', async () => {
  const calls = mockFetch({ data: { state: 'ok', data: ROWS, collected_at: 'x', host: 'a.com', property_id: '1' } });
  const r = await autoSchedule(Y, 3, []);
  assert.equal(calls[0].startsWith('/api/analytics/ga4-pattern'), true);
  assert.equal(r.data.ga4Fallback, false);
  assert.ok(r.data.proposals.length > 0);
  for (const p of r.data.proposals) {
    const dow = new Date(p.date).getDay();
    const allowed = { blog: [1, 2], instagram: [3], facebook: [5] }[p.channel];
    assert.ok(allowed.includes(dow), `${p.channel} ${p.date}`);
  }
});

for (const [name, block, expect] of [
  ['error', { state: 'error', code: 'timeout', retryable: true }, 'GA4 연결 오류 · 잠시 후 다시 시도'],
  ['not_configured', { state: 'not_configured' }, 'GA4 연결 필요'],
  ['domain_required', { state: 'domain_required' }, /자동화 도메인/],
]) {
  test(`autoSchedule: ${name} 블록 → 제안 0건 + 한글 안내 (0 패턴 편성 금지)`, async () => {
    mockFetch({ data: block });
    const r = await autoSchedule(Y, 3, []);
    assert.equal(r.data.ga4Fallback, true);
    assert.equal(r.data.proposals.length, 0);
    if (expect instanceof RegExp) assert.match(r.data.ga4Error, expect); else assert.equal(r.data.ga4Error, expect);
  });
}

test('autoSchedule: ok 이지만 세션 0 → 제안 0건 + 안내', async () => {
  mockFetch({ data: { state: 'ok', data: [], collected_at: 'x', host: 'a.com', property_id: '1' } });
  const r = await autoSchedule(Y, 3, []);
  assert.equal(r.data.ga4Fallback, true);
  assert.equal(r.data.proposals.length, 0);
  assert.match(r.data.ga4Error, /세션 데이터가 없습니다/);
});

test('autoSchedule: HTTP 실패 → 예외 대신 안내', async () => {
  mockFetch({ error: { message: '인증이 필요합니다' } }, 401);
  const r = await autoSchedule(Y, 3, []);
  assert.equal(r.data.ga4Fallback, true);
  assert.equal(r.data.ga4Error, '인증이 필요합니다');
});
