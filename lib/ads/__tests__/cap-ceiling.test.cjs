/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require */
// 하루 상한 천장 [대장 결정 2026-11-11] 1만 원(VAT 별도). 천장 위의 계정 행은 잘라 쓰지 않고 거부한다(fail closed).
// 입찰 상한(maxBidKrw)은 하루 상한을 넘을 수 없다. 감시 경보 계산(90%·100%·비즈머니 3일치)은 계정 상한을 그대로 쓴다.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DAILY_CAP_CEILING_KRW, AdsInvariantError, buildCampaign, buildSharedBudget, verifyStored } = require('../requests.ts');
const { caps } = require('../invariants.ts');

const ROW = { naverCustomerId: '1234567', dailyCapKrw: 10000, sharedBudgetKrw: 10000, maxBidKrw: 2000, sharedBudgetId: 'sb-1', businessChannelId: 'bsn-1' };
const invariant = (field) => (e) => e instanceof AdsInvariantError && e.field === field;

test('ceiling is 10,000 KRW; a 10,000 row passes, the old 100,000 row is rejected (no clamping)', () => {
  assert.equal(DAILY_CAP_CEILING_KRW, 10000);
  assert.deepEqual(caps(ROW), { dailyCapKrw: 10000, budget: 10000, maxBid: 2000 });
  for (const dailyCapKrw of [100000, 10001]) {
    const old = { ...ROW, dailyCapKrw, sharedBudgetKrw: 100000 };
    assert.throws(() => caps(old), invariant('dailyCapKrw'), String(dailyCapKrw));
    assert.throws(() => buildCampaign(old, 'c'), invariant('dailyCapKrw'));
    assert.throws(() => buildSharedBudget(old, { nccCampaignId: 'cmp-1', name: 'c' }), invariant('dailyCapKrw'));
    assert.deepEqual(verifyStored('sharedBudget', old, { sharedBudgetId: 'sb-1', ownerType: 'CAMPAIGN', dailyBudget: 10000 }), { ok: false, field: 'dailyCapKrw' });
  }
  // 공유예산 금액이 상한보다 커도 실제 하루 예산은 min(공유예산, 상한) = 1만 원
  assert.equal(buildCampaign({ ...ROW, sharedBudgetKrw: 100000 }, 'c').dailyBudget, 10000);
  assert.deepEqual(verifyStored('sharedBudget', ROW, { sharedBudgetId: 'sb-1', ownerType: 'CAMPAIGN', dailyBudget: 10001 }), { ok: false, field: 'dailyBudget' });
});

test('max bid can never exceed the daily cap', () => {
  assert.equal(caps({ ...ROW, maxBidKrw: 10000 }).maxBid, 10000);
  assert.throws(() => caps({ ...ROW, maxBidKrw: 10001 }), invariant('maxBidKrw'));
  assert.throws(() => caps({ ...ROW, dailyCapKrw: 5000, maxBidKrw: 6000 }), invariant('maxBidKrw'));
});
