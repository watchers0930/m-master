/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require */
// 콘텐츠별 성과 합계 — 측정 불가 행을 0 으로 합산하지 않는다 (교차검수 회귀 방지).
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computePerfTotals, NO_MEASURABLE_REASON } = require('../content-performance-totals.ts');

const m = (sessions, pv = sessions * 2) => ({ sessions, screenPageViews: pv, averageSessionDuration: 0, bounceRate: 0, engagementRate: 0 });
const ok = data => ({ state: 'ok', data, collected_at: 'x', host: 'h', property_id: 'p' });
const ERR = { state: 'error', code: 'upstream', retryable: true };

test('GA4 실패 → unavailable (0 합계 금지)', () => {
  assert.deepEqual(computePerfTotals([{ page_path: '/a', naver_sessions: null }], ERR, ERR), { state: 'unavailable' });
});

test('모든 행 page_path null → no_measurable + 사유', () => {
  const t = computePerfTotals([{ page_path: null, naver_sessions: null }, { page_path: null, naver_sessions: null }], ok({}), ok({}));
  assert.deepEqual(t, { state: 'no_measurable', reason: NO_MEASURABLE_REASON });
});

test('측정 가능한 행만 합산 + 건수', () => {
  const rows = [{ page_path: '/a', naver_sessions: 3 }, { page_path: null, naver_sessions: null }, { page_path: '/b', naver_sessions: 1 }];
  const t = computePerfTotals(rows, ok({ '/a': m(10), '/b': m(30) }), ok({ '/a': 3, '/b': 1 }));
  assert.equal(t.state, 'ok');
  assert.equal(t.measured, 2);
  assert.equal(t.sessions, 40);
  assert.equal(t.pageViews, 80);
  assert.deepEqual(t.naver, { state: 'ok', measured: 2, sessions: 4, ratio: 0.1 });
});

test('네이버 블록 실패 → 네이버 합계 unknown (세션 합계는 유지)', () => {
  const t = computePerfTotals([{ page_path: '/a', naver_sessions: null }], ok({ '/a': m(10) }), ERR);
  assert.equal(t.state, 'ok');
  assert.deepEqual(t.naver, { state: 'unknown' });
});

test('네이버 값 일부 null → 아는 행만, 비율 분모도 같은 행', () => {
  const rows = [{ page_path: '/a', naver_sessions: 5 }, { page_path: '/b', naver_sessions: null }];
  const t = computePerfTotals(rows, ok({ '/a': m(10), '/b': m(90) }), ok({ '/a': 5 }));
  assert.deepEqual(t.naver, { state: 'ok', measured: 1, sessions: 5, ratio: 0.5 });
});
