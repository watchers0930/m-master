/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require */
// 공유예산 핫픽스(2026-11-11 실호출 400/1002): 생성 본문은 deliveryMethod + campaignList(CampaignRequest 1개)를 반드시 싣고(#834·#962·#828),
// 기존 공유예산에 붙이기는 PUT ?fields=sharedBudget 최소 본문(#962). 캠페인 생성 본문에는 sharedBudgetId가 없다(붙이기는 한 경로뿐).
// 붙이기 전 캠페인 재조회는 campaignPreAttach(자기 하루 예산이 상한), 붙인 뒤는 기존 campaign(공유예산 연결 필수)으로 대조한다.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSharedBudget, buildSharedBudgetAttach, buildCampaign, assertInvariants, verifyStored, AdsInvariantError } = require('../requests.ts');

const ACC = Object.freeze({ naverCustomerId: '1234567', dailyCapKrw: 10000, sharedBudgetKrw: 9000, maxBidKrw: 2000, sharedBudgetId: 'sb-1', businessChannelId: 'bsn-1' });
const acc = (patch = {}) => ({ ...ACC, ...patch });
const NONE = acc({ sharedBudgetId: null });
const CAMP = { nccCampaignId: 'cmp-1', name: 'mq-p1' };
const invariant = (field) => (e) => {
  assert.ok(e instanceof AdsInvariantError, `AdsInvariantError expected, got ${e && e.name}: ${e && e.message}`);
  assert.equal(e.field, field);
  return true;
};

test('shared budget create body carries deliveryMethod and exactly one CampaignRequest (live 1002 fix)', () => {
  const want = {
    customerId: 1234567, name: 'mq-cap', ownerType: 'CAMPAIGN', deliveryMethod: 'ACCELERATED', dailyBudget: 9000,
    campaignList: [{ nccCampaignId: 'cmp-1', customerId: 1234567, name: 'mq-p1', campaignTp: 'WEB_SITE' }],
  };
  assert.deepEqual(buildSharedBudget(NONE, CAMP), want);
  assert.deepEqual(buildSharedBudget(ACC, CAMP), want, '계정 sharedBudgetId와 무관');
  assert.throws(() => buildSharedBudget(NONE, { ...CAMP, nccCampaignId: '' }), invariant('nccCampaignId'));
  assert.throws(() => buildSharedBudget(NONE, { ...CAMP, name: ' ' }), invariant('name'));
  assert.throws(() => buildSharedBudget(NONE), invariant('campaign'));
  assert.throws(() => buildSharedBudget(acc({ sharedBudgetId: null, dailyCapKrw: 10001 }), CAMP), invariant('dailyCapKrw'));
});

test('assertInvariants(sharedBudget) allows campaignList only with exactly the CampaignRequest fields', () => {
  const ok = buildSharedBudget(NONE, CAMP);
  const item = ok.campaignList[0];
  const cases = [
    [{ deliveryMethod: undefined }, 'deliveryMethod'],
    [{ deliveryMethod: 'STANDARD' }, 'deliveryMethod'],
    [{ campaignList: undefined }, 'campaignList'],
    [{ campaignList: [] }, 'campaignList'],
    [{ campaignList: {} }, 'campaignList'],
    [{ campaignList: [item, { ...item, nccCampaignId: 'cmp-2' }] }, 'campaignList'],
    [{ campaignList: [{ ...item, userLock: false }] }, 'campaignList.userLock'],
    [{ campaignList: [{ ...item, sharedBudgetId: 'sb-x' }] }, 'campaignList.sharedBudgetId'],
    [{ campaignList: [{ ...item, customerId: undefined }] }, 'campaignList.customerId'],
    [{ campaignList: [{ ...item, customerId: 7654321 }] }, 'campaignList.customerId'],
    [{ campaignList: [{ ...item, campaignTp: 'SHOPPING' }] }, 'campaignList.campaignTp'],
    [{ campaignList: [{ ...item, nccCampaignId: '' }] }, 'campaignList.nccCampaignId'],
    [{ campaignList: [{ ...item, name: '' }] }, 'campaignList.name'],
    [{ campaignList: [null] }, 'campaignList'],
    [{ adgroupList: [] }, 'adgroupList'],
    [{ ownerType: 'ADGROUP' }, 'ownerType'],
    [{ dailyBudget: 10001 }, 'dailyBudget'],
  ];
  assert.doesNotThrow(() => assertInvariants('sharedBudget', NONE, ok));
  for (const [patch, field] of cases) assert.throws(() => assertInvariants('sharedBudget', NONE, { ...ok, ...patch }), invariant(field), JSON.stringify(patch));
});

test('campaign create body never carries sharedBudgetId; the account may have none yet', () => {
  for (const a of [NONE, ACC]) {
    const body = buildCampaign(a, 'mq-p1');
    assert.equal(Object.hasOwn(body, 'sharedBudgetId'), false);
    assert.deepEqual(body, { customerId: 1234567, name: 'mq-p1', campaignTp: 'WEB_SITE', useDailyBudget: true, dailyBudget: 9000, userLock: true });
  }
  const body = buildCampaign(ACC, 'c');
  assert.throws(() => assertInvariants('campaign', ACC, { ...body, sharedBudgetId: 'sb-1' }), invariant('sharedBudgetId'), '붙이기는 PUT 한 경로뿐');
  assert.throws(() => assertInvariants('campaign', NONE, { ...body, sharedBudgetId: 'sb-x' }), invariant('sharedBudgetId'));
  assert.throws(() => buildCampaign(ACC, 'c', { sharedBudgetId: 'sb-1' }), invariant('sharedBudgetId'));
});

test('attach body is the #962 minimal body built only from the account and the stored budget amount', () => {
  assert.deepEqual(buildSharedBudgetAttach(ACC, 'cmp-1', 9000), {
    nccCampaignId: 'cmp-1', customerId: 1234567, sharedBudgetId: 'sb-1', sharedDailyBudget: 9000, sharedBudgetName: 'mq-cap',
  });
  assert.equal(buildSharedBudgetAttach(ACC, 'cmp-1', 5000).sharedDailyBudget, 5000, '저장된 금액(대장이 낮췄을 수 있음)을 올리지 않는다');
  for (const v of [null, undefined, '', '  ']) assert.throws(() => buildSharedBudgetAttach(acc({ sharedBudgetId: v }), 'cmp-1', 9000), invariant('sharedBudgetId'));
  assert.throws(() => buildSharedBudgetAttach(ACC, '', 9000), invariant('nccCampaignId'));
  for (const v of [10001, 0, -1, 1.5, '9000', null]) assert.throws(() => buildSharedBudgetAttach(ACC, 'cmp-1', v), invariant('sharedDailyBudget'), String(v));
  const ok = buildSharedBudgetAttach(ACC, 'cmp-1', 9000);
  for (const [patch, field] of [
    [{ userLock: false }, 'userLock'], [{ dailyBudget: 1 }, 'dailyBudget'], [{ sharedBudgetId: 'sb-x' }, 'sharedBudgetId'],
    [{ sharedBudgetName: 'other' }, 'sharedBudgetName'], [{ customerId: 7654321 }, 'customerId'], [{ nccCampaignId: undefined }, 'nccCampaignId'],
    [{ sharedDailyBudget: 10001 }, 'sharedDailyBudget'],
  ]) assert.throws(() => assertInvariants('sharedBudgetAttach', ACC, { ...ok, ...patch }), invariant(field), JSON.stringify(patch));
  assert.throws(() => assertInvariants('sharedBudgetAttach', ACC, [ok]), invariant('body'));
});

test('campaignPreAttach: unattached campaign is capped by its own daily budget; any other budget link is drift', () => {
  const stored = { nccCampaignId: 'cmp-1', name: 'c', sharedBudgetId: null, sharedDailyBudget: null, useDailyBudget: true, dailyBudget: 9000 };
  assert.deepEqual(verifyStored('campaignPreAttach', NONE, stored), { ok: true });
  const { sharedBudgetId, sharedDailyBudget, ...bare } = stored; void [sharedBudgetId, sharedDailyBudget];
  assert.deepEqual(verifyStored('campaignPreAttach', NONE, bare), { ok: true }, '필드 없음 = 미연결');
  assert.deepEqual(verifyStored('campaignPreAttach', ACC, { ...stored, sharedBudgetId: 'sb-1', sharedDailyBudget: 9000 }), { ok: true }, '이미 붙은 재개');
  for (const [a, patch, field] of [
    [NONE, { sharedBudgetId: 'sb-x' }, 'sharedBudgetId'], [ACC, { sharedBudgetId: 'sb-x' }, 'sharedBudgetId'],
    [NONE, { useDailyBudget: false }, 'useDailyBudget'], [NONE, { dailyBudget: 10001 }, 'dailyBudget'], [NONE, { dailyBudget: 0 }, 'dailyBudget'],
    [ACC, { sharedBudgetId: 'sb-1', sharedDailyBudget: 1e9 }, 'sharedDailyBudget'], [NONE, { dailyBudget: '9000' }, 'shape'], [NONE, null, 'shape'],
  ]) assert.deepEqual(verifyStored('campaignPreAttach', a, patch === null ? null : { ...stored, ...patch }), { ok: false, field }, JSON.stringify(patch));
  assert.deepEqual(verifyStored('campaign', NONE, stored), { ok: false, field: 'sharedBudgetId' }, '붙인 뒤 검증·켜기는 여전히 공유예산 연결 필수');
});
