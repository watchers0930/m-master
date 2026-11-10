/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 적용 실행기 순수 단위: 비상 정지 스위치(fail-closed, 정확히 'true'만), 실패 코드 매핑(네이버 반려 코드 → 린트 규칙 id).
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
// 순수 단위: 세션·DB 모듈은 쓰지 않는다(불리면 실패하도록 함정)
const trap = new Proxy({}, { get: () => { throw new Error('db must not be touched'); } });
require.cache[require.resolve('../../auth.ts')] = { exports: { requireSession: async () => { throw new Error('Unauthorized'); } } };
require.cache[require.resolve('../../prisma.ts')] = { exports: { prisma: trap } };
const { assertExecutionEnabled, isExecutionEnabled } = require('../execution.ts');
const { failCodeOf, ApplyFailure } = require('../apply-errors.ts');
const { NaverAdsError } = require('../../external/naver-searchad.ts');
const { AdsInvariantError } = require('../invariants.ts');
const { LINT_RULES } = require('../lint-rules.ts');

test('execution switch is fail-closed: only the exact string "true" enables writes', () => {
  const saved = process.env.ADS_EXECUTION_ENABLED;
  try {
    for (const value of [undefined, '', 'false', 'TRUE', 'True', ' true', 'true ', '1', 'yes']) {
      if (value === undefined) delete process.env.ADS_EXECUTION_ENABLED; else process.env.ADS_EXECUTION_ENABLED = value;
      assert.equal(isExecutionEnabled(), false, JSON.stringify(value));
      assert.throws(() => assertExecutionEnabled(), (e) => e.code === 'ads_paused' && e.status === 503, JSON.stringify(value));
    }
    process.env.ADS_EXECUTION_ENABLED = 'true';
    assert.equal(isExecutionEnabled(), true);
    assert.doesNotThrow(() => assertExecutionEnabled());
  } finally {
    if (saved === undefined) delete process.env.ADS_EXECUTION_ENABLED; else process.env.ADS_EXECUTION_ENABLED = saved;
  }
});

test('failCodeOf maps Naver rejection codes to the Task 7 lint rule ids and keeps the step for uncertain writes', () => {
  const step = 'keyword:g1:k0';
  assert.equal(failCodeOf(new NaverAdsError('ads_rejected', 3909, 400), step), `lint:${LINT_RULES.forbiddenKeyword.id}`);
  assert.equal(failCodeOf(new NaverAdsError('ads_rejected', 3906, 400), step), `lint:${LINT_RULES.keywordSpecialChar.id}`);
  assert.equal(failCodeOf(new NaverAdsError('ads_rejected', 3822, 400), step), `lint:${LINT_RULES.duplicateCreative.id}`);
  assert.equal(failCodeOf(new NaverAdsError('ads_rejected', 4001, 400), step), 'rejected:4001');
  assert.equal(failCodeOf(new NaverAdsError('ads_rejected', undefined, 400), step), 'rejected:unknown');
  assert.equal(failCodeOf(new NaverAdsError('ads_uncertain'), step), `uncertain:${step}`);
  assert.equal(failCodeOf(new NaverAdsError('ads_unavailable'), step), 'ads_unavailable');
  assert.equal(failCodeOf(new NaverAdsError('ads_not_connected'), step), 'ads_not_connected');
  assert.equal(failCodeOf(new AdsInvariantError('bidAmt'), step), 'invariant:bidAmt');
  assert.equal(failCodeOf(new ApplyFailure('drift:aiAdsOptIn'), step), 'drift:aiAdsOptIn');
  assert.equal(failCodeOf(new Error('boom'), step), null, '모르는 오류는 코드로 위장하지 않는다(호출자가 다시 던짐)');
});

test('pause-only client accepts only PUT ?fields=userLock with {ncc*Id, userLock:true}', () => {
  const { isPauseBody } = require('../../external/naver-searchad.ts');
  const q = { fields: 'userLock' };
  for (const id of ['nccCampaignId', 'nccAdgroupId', 'nccKeywordId', 'nccAdId']) assert.equal(isPauseBody({ [id]: 'x-1', userLock: true }, q), true, id);
  for (const [body, query, why] of [
    [{ nccKeywordId: 'x', userLock: false }, q, 'resume'], [{ nccKeywordId: 'x', userLock: true, bidAmt: 99999 }, q, 'extra field'],
    [{ nccKeywordId: 'x', userLock: true }, { fields: 'bidAmt' }, 'other fields'], [{ nccKeywordId: 'x', userLock: true }, undefined, 'no query'],
    [{ name: 'x', userLock: true }, q, 'not an id'], [{ nccKeywordId: '', userLock: true }, q, 'empty id'], [[{ nccKeywordId: 'x', userLock: true }], q, 'array'],
  ]) assert.equal(isPauseBody(body, query), false, why);
});
