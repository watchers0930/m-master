/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require */
// 보내기 직전 본문 검사(assertInvariants)와 쓰기 후 재조회 검증(verifyStored): 모든 안전 필드 drift를 field명까지 고정.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSharedBudget, buildCampaign, buildAdgroup, buildKeyword, buildTextAd,
  assertInvariants, verifyStored, AdsInvariantError,
} = require('../requests.ts');

const ACC = Object.freeze({ naverCustomerId: '1234567', dailyCapKrw: 100000, sharedBudgetKrw: 90000, maxBidKrw: 2000, sharedBudgetId: 'sb-1', businessChannelId: 'bsn-1' });
const acc = (patch = {}) => ({ ...ACC, ...patch });
const invariant = field => e => {
  assert.ok(e instanceof AdsInvariantError, `AdsInvariantError expected, got ${e && e.name}: ${e && e.message}`);
  assert.equal(e.field, field);
  return true;
};
const AD = { headline: '전세 사기 확인', description: '등기부 위험도를 1분 만에 확인하세요', pcUrl: 'https://vestra.ai.kr', mobileUrl: 'https://vestra.ai.kr/m' };
const bodies = () => ({
  sharedBudget: buildSharedBudget(ACC),
  campaign: buildCampaign(ACC, 'c'),
  adgroup: buildAdgroup(ACC, 'cmp', 'g', 100),
  keyword: buildKeyword(ACC, 'grp', 'k', 100).body[0],
  ad: buildTextAd('grp', AD),
});

test('assertInvariants rejects any weakened body', () => {
  const b = bodies();
  for (const [kind, body] of Object.entries(b)) assert.doesNotThrow(() => assertInvariants(kind, ACC, body), kind);
  const drifts = [
    ['sharedBudget', { dailyBudget: 100001 }, 'dailyBudget'],
    ['sharedBudget', { dailyBudget: 0 }, 'dailyBudget'],
    ['sharedBudget', { ownerType: 'ADGROUP' }, 'ownerType'],
    ['sharedBudget', { ownerType: undefined }, 'ownerType'],
    ['sharedBudget', { customerId: 7654321 }, 'customerId'],
    ['sharedBudget', { customerId: '1234567' }, 'customerId'],
    ['sharedBudget', { adgroupList: [] }, 'adgroupList'],
    ['sharedBudget', { campaignList: [{ nccCampaignId: 'x' }] }, 'campaignList'],
    ['campaign', { customerId: undefined }, 'customerId'],
    ['campaign', { sharedBudgetId: 'sb-x' }, 'sharedBudgetId'],
    ['campaign', { sharedBudgetId: undefined }, 'sharedBudgetId'],
    ['campaign', { useDailyBudget: false }, 'useDailyBudget'],
    ['campaign', { dailyBudget: 100001 }, 'dailyBudget'],
    ['campaign', { dailyBudget: '90000' }, 'dailyBudget'],
    ['campaign', { campaignTp: 'SHOPPING' }, 'campaignTp'],
    ['campaign', { userLock: false }, 'userLock'],
    ['adgroup', { aiAdsOptIn: true }, 'aiAdsOptIn'],
    ['adgroup', { aiAdsOptIn: undefined }, 'aiAdsOptIn'],
    ['adgroup', { useExpSearch: true }, 'useExpSearch'],
    ['adgroup', { useExpSearch: undefined }, 'useExpSearch'],
    ['adgroup', { useDailyBudget: false }, 'useDailyBudget'],
    ['adgroup', { dailyBudget: 100001 }, 'dailyBudget'],
    ['adgroup', { bidAmt: 2001 }, 'bidAmt'],
    ['adgroup', { bidAmt: 69 }, 'bidAmt'],
    ['adgroup', { pcNetworkBidWeight: 500 }, 'pcNetworkBidWeight'],
    ['adgroup', { pcNetworkBidWeight: undefined }, 'pcNetworkBidWeight'],
    ['adgroup', { mobileNetworkBidWeight: 101 }, 'mobileNetworkBidWeight'],
    ['adgroup', { useCntsNetworkBidAmt: true }, 'useCntsNetworkBidAmt'],
    ['adgroup', { systemBiddingType: 'ML' }, 'systemBiddingType'],
    ['adgroup', { systemBiddingType: undefined }, 'systemBiddingType'],
    ['adgroup', { sharedBudgetId: 'sb-evil' }, 'sharedBudgetId'],
    ['adgroup', { pcChannelId: 'bsn-x' }, 'pcChannelId'],
    ['adgroup', { mobileChannelId: 'bsn-x' }, 'mobileChannelId'],
    ['adgroup', { adgroupType: 'SHOPPING' }, 'adgroupType'],
    ['adgroup', { userLock: false }, 'userLock'],
    ['keyword', { bidAmt: 2001 }, 'bidAmt'],
    ['keyword', { useGroupBidAmt: 'no' }, 'useGroupBidAmt'],
    ['keyword', { userLock: false }, 'userLock'],
    ['ad', { type: 'RSA_AD' }, 'type'],
    ['ad', { userLock: false }, 'userLock'],
  ];
  for (const [kind, patch, field] of drifts) {
    assert.throws(() => assertInvariants(kind, ACC, { ...b[kind], ...patch }), invariant(field), `${kind} ${JSON.stringify(patch)}`);
  }
  assert.doesNotThrow(() => assertInvariants('adgroup', ACC, { ...b.adgroup, sharedBudgetId: null }));
  assert.doesNotThrow(() => assertInvariants('keyword', ACC, { ...b.keyword, useGroupBidAmt: true, bidAmt: 999999 }));
  assert.throws(() => assertInvariants('campaign', ACC, null), invariant('body'));
  assert.throws(() => assertInvariants('nope', ACC, {}), invariant('kind'));
  assert.throws(() => assertInvariants('campaign', acc({ dailyCapKrw: 0 }), b.campaign), invariant('dailyCapKrw'));
});

test('cap comparisons use the account dailyCapKrw, not the 100,000 ceiling (M15)', () => {
  const low = acc({ dailyCapKrw: 50000 });
  const b = bodies(); // dailyBudget 90,000으로 만들어진 본문
  for (const kind of ['sharedBudget', 'campaign', 'adgroup']) {
    assert.throws(() => assertInvariants(kind, low, b[kind]), invariant('dailyBudget'), kind);
  }
  assert.deepEqual(verifyStored('campaign', low, STORED.campaign), { ok: false, field: 'dailyBudget' });
  assert.deepEqual(verifyStored('adgroup', low, STORED.adgroup), { ok: false, field: 'dailyBudget' });
  assert.deepEqual(verifyStored('sharedBudget', low, STORED.sharedBudget), { ok: false, field: 'dailyBudget' });
  assert.deepEqual(verifyStored('campaign', low, { ...STORED.campaign, dailyBudget: 50000 }), { ok: false, field: 'sharedDailyBudget' });
});

// 네이버에 실제 저장된 값(재조회 GET 응답) 예시. 추가 필드는 무시된다.
const STORED = {
  campaign: { nccCampaignId: 'cmp-1', name: 'c', sharedBudgetId: 'sb-1', sharedDailyBudget: 90000, useDailyBudget: true, dailyBudget: 90000, extra: { x: 1 } },
  adgroup: {
    nccAdgroupId: 'grp-1', aiAdsOptIn: false, useExpSearch: false, useDailyBudget: true, dailyBudget: 90000, bidAmt: 500, expSearchBudgetRatio: 100,
    pcNetworkBidWeight: 100, mobileNetworkBidWeight: 100, useCntsNetworkBidAmt: false, systemBiddingType: 'NONE', sharedBudgetId: null,
  },
  keyword: { nccKeywordId: 'kw-1', useGroupBidAmt: false, bidAmt: 300 },
  sharedBudget: { sharedBudgetId: 'sb-1', ownerType: 'CAMPAIGN', dailyBudget: 90000, status: 'ELIGIBLE' },
};

test('verifyStored accepts stored values that honour the invariants', () => {
  for (const [kind, stored] of Object.entries(STORED)) assert.deepEqual(verifyStored(kind, ACC, stored), { ok: true }, kind);
  assert.deepEqual(verifyStored('keyword', ACC, { useGroupBidAmt: true, bidAmt: 999999 }), { ok: true });
  assert.deepEqual(verifyStored('campaign', ACC, { ...STORED.campaign, dailyBudget: 100000 }), { ok: true });
  // 입찰배수·자동입찰·그룹 공유예산 필드가 응답에 없으면 허용(낮은 가중치는 입찰을 줄일 뿐)
  const { pcNetworkBidWeight, mobileNetworkBidWeight, useCntsNetworkBidAmt, systemBiddingType, sharedBudgetId, ...bare } = STORED.adgroup;
  void [pcNetworkBidWeight, mobileNetworkBidWeight, useCntsNetworkBidAmt, systemBiddingType, sharedBudgetId];
  assert.deepEqual(verifyStored('adgroup', ACC, bare), { ok: true });
  assert.deepEqual(verifyStored('adgroup', ACC, { ...STORED.adgroup, pcNetworkBidWeight: 10 }), { ok: true });
  const { status, ...noStatus } = STORED.sharedBudget; void status;
  assert.deepEqual(verifyStored('sharedBudget', ACC, noStatus), { ok: true }, '상태 필드가 없으면 다른 검사로 판정');
});

test('verifyStored flags each drifted field', () => {
  const drifts = [
    ['campaign', { sharedBudgetId: 'sb-other' }, 'sharedBudgetId'],
    ['campaign', { sharedBudgetId: null, sharedDailyBudget: null }, 'sharedBudgetId'],
    ['campaign', { useDailyBudget: false }, 'useDailyBudget'],
    ['campaign', { dailyBudget: 100001 }, 'dailyBudget'],
    ['campaign', { dailyBudget: 0 }, 'dailyBudget'],
    ['campaign', { sharedDailyBudget: 1e9 }, 'sharedDailyBudget'],
    ['campaign', { sharedDailyBudget: 0 }, 'sharedDailyBudget'],
    ['adgroup', { aiAdsOptIn: true }, 'aiAdsOptIn'],
    ['adgroup', { useExpSearch: true }, 'useExpSearch'],
    ['adgroup', { useDailyBudget: false }, 'useDailyBudget'],
    ['adgroup', { dailyBudget: 100001 }, 'dailyBudget'],
    ['adgroup', { bidAmt: 2001 }, 'bidAmt'],
    ['adgroup', { bidAmt: 69 }, 'bidAmt'],
    ['adgroup', { pcNetworkBidWeight: 101 }, 'pcNetworkBidWeight'],
    ['adgroup', { mobileNetworkBidWeight: 500 }, 'mobileNetworkBidWeight'],
    ['adgroup', { useCntsNetworkBidAmt: true }, 'useCntsNetworkBidAmt'],
    ['adgroup', { systemBiddingType: 'ML' }, 'systemBiddingType'],
    ['adgroup', { sharedBudgetId: 'sb-evil' }, 'sharedBudgetId'],
    ['adgroup', { sharedBudgetId: 'sb-1' }, 'sharedBudgetId'],
    ['keyword', { bidAmt: 2001 }, 'bidAmt'],
    ['keyword', { bidAmt: 69 }, 'bidAmt'],
    ['sharedBudget', { dailyBudget: 100001 }, 'dailyBudget'],
    ['sharedBudget', { sharedBudgetId: 'sb-OTHER', dailyBudget: 70 }, 'sharedBudgetId'],
    ['sharedBudget', { ownerType: 'ADGROUP' }, 'ownerType'],
    ['sharedBudget', { status: 'DELETED' }, 'status'], // 네이버 화면에서 mq-cap을 지웠으면 1층 상한이 없다(최종 판정 A5)
  ];
  for (const [kind, patch, field] of drifts) {
    assert.deepEqual(verifyStored(kind, ACC, { ...STORED[kind], ...patch }), { ok: false, field }, `${kind} ${JSON.stringify(patch)}`);
  }
});

test('verifyStored never returns ok on an unparseable shape', () => {
  const shapes = [
    ['campaign', null], ['campaign', 'x'], ['campaign', []], ['campaign', {}],
    ['campaign', { ...STORED.campaign, sharedBudgetId: undefined }],
    ['campaign', { ...STORED.campaign, sharedDailyBudget: undefined }],
    ['campaign', { ...STORED.campaign, sharedDailyBudget: null }],
    ['campaign', { ...STORED.campaign, sharedDailyBudget: '90000' }],
    ['campaign', { ...STORED.campaign, useDailyBudget: 'true' }],
    ['campaign', { ...STORED.campaign, dailyBudget: '90000' }],
    ['campaign', { ...STORED.campaign, dailyBudget: undefined }],
    ['adgroup', { ...STORED.adgroup, aiAdsOptIn: undefined }],
    ['adgroup', { ...STORED.adgroup, useExpSearch: null }],
    ['adgroup', { ...STORED.adgroup, bidAmt: '500' }],
    ['adgroup', { ...STORED.adgroup, bidAmt: NaN }],
    ['adgroup', { ...STORED.adgroup, useDailyBudget: undefined }],
    ['adgroup', { ...STORED.adgroup, pcNetworkBidWeight: '100' }],
    ['adgroup', { ...STORED.adgroup, useCntsNetworkBidAmt: 'false' }],
    ['adgroup', { ...STORED.adgroup, systemBiddingType: 7 }],
    ['keyword', { useGroupBidAmt: false }],
    ['keyword', { bidAmt: 300 }],
    ['sharedBudget', {}],
    ['sharedBudget', { dailyBudget: 90000 }],
    ['sharedBudget', { ...STORED.sharedBudget, ownerType: undefined }],
  ];
  for (const [kind, stored] of shapes) {
    assert.deepEqual(verifyStored(kind, ACC, stored), { ok: false, field: 'shape' }, `${kind} ${JSON.stringify(stored)}`);
  }
  assert.deepEqual(verifyStored('ad', ACC, {}), { ok: false, field: 'kind' });
  assert.deepEqual(verifyStored('campaign', acc({ sharedBudgetId: null }), STORED.campaign), { ok: false, field: 'sharedBudgetId' });
  assert.deepEqual(verifyStored('campaign', acc({ dailyCapKrw: NaN }), STORED.campaign), { ok: false, field: 'dailyCapKrw' });
});

test('empty account sharedBudgetId never matches an empty stored id (M22)', () => {
  const a = acc({ sharedBudgetId: '' });
  assert.deepEqual(verifyStored('campaign', a, { ...STORED.campaign, sharedBudgetId: '' }), { ok: false, field: 'sharedBudgetId' });
  assert.deepEqual(verifyStored('sharedBudget', a, { ...STORED.sharedBudget, sharedBudgetId: '' }), { ok: false, field: 'sharedBudgetId' });
  assert.deepEqual(verifyStored('campaign', acc({ sharedBudgetId: '  ' }), { ...STORED.campaign, sharedBudgetId: '  ' }), { ok: false, field: 'sharedBudgetId' });
});

test('verifyStored rethrows non-invariant exceptions instead of masking them (M18)', () => {
  const boom = { ...ACC };
  Object.defineProperty(boom, 'dailyCapKrw', { get() { throw new TypeError('account read failed'); } });
  assert.throws(() => verifyStored('campaign', boom, STORED.campaign), e => e instanceof TypeError && e.message === 'account read failed');
});
