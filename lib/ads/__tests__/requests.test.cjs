/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require */
// 상한 불변식 요청 빌더: 하루 상한·ADVoost·확장검색·잠금 강제, 호출자 덮어쓰기 거부, 재조회 검증(drift 판정).
// 네트워크·DB 없음. 순수 함수만 검사한다.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSharedBudget, buildCampaign, buildAdgroup, buildKeyword, buildTextAd,
  assertInvariants, verifyStored, AdsInvariantError,
} = require('../requests.ts');

const ACC = Object.freeze({ dailyCapKrw: 100000, sharedBudgetKrw: 90000, maxBidKrw: 2000, sharedBudgetId: 'sb-1', businessChannelId: 'bsn-1' });
const acc = (patch = {}) => ({ ...ACC, ...patch });
const invariant = field => e => {
  assert.ok(e instanceof AdsInvariantError, `AdsInvariantError expected, got ${e && e.name}: ${e && e.message}`);
  assert.equal(e.field, field);
  return true;
};
const AD = { headline: '전세 사기 확인', description: '등기부 위험도를 1분 만에 확인하세요', pcUrl: 'https://vestra.ai.kr', mobileUrl: 'https://vestra.ai.kr/m' };

test('builders always emit safety fields', () => {
  assert.deepEqual(buildSharedBudget(ACC), { name: 'mq-cap', dailyBudget: 90000 });
  assert.deepEqual(buildCampaign(ACC, 'mq-p1'), {
    name: 'mq-p1', campaignTp: 'WEB_SITE', sharedBudgetId: 'sb-1', useDailyBudget: true, dailyBudget: 90000, userLock: true,
  });
  assert.deepEqual(buildAdgroup(ACC, 'cmp-1', 'mq-p1-g1', 500), {
    nccCampaignId: 'cmp-1', name: 'mq-p1-g1', adgroupType: 'WEB_SITE', pcChannelId: 'bsn-1', mobileChannelId: 'bsn-1',
    bidAmt: 500, useDailyBudget: true, dailyBudget: 90000, aiAdsOptIn: false, useExpSearch: false, userLock: true,
  });
  assert.deepEqual(buildKeyword(ACC, 'grp-1', '전세사기', 300), {
    nccAdgroupId: 'grp-1', keyword: '전세사기', bidAmt: 300, useGroupBidAmt: false, userLock: true,
  });
  assert.deepEqual(buildTextAd('grp-1', AD), {
    nccAdgroupId: 'grp-1', type: 'TEXT_45', userLock: true,
    ad: { headline: AD.headline, description: AD.description, pc: { final: AD.pcUrl }, mobile: { final: AD.mobileUrl } },
  });
});

test('dailyBudget is min(sharedBudgetKrw, dailyCapKrw) for shared budget, campaign and adgroup', () => {
  const a = acc({ dailyCapKrw: 80000, sharedBudgetKrw: 100000 });
  assert.equal(buildSharedBudget(a).dailyBudget, 80000);
  assert.equal(buildCampaign(a, 'c').dailyBudget, 80000);
  assert.equal(buildAdgroup(a, 'cmp', 'g', 100).dailyBudget, 80000);
});

test('bid outside 70..maxBid throws', () => {
  for (const bid of [69, 0, -1, 2001, 100001, 70.5, NaN, Infinity, -Infinity, '500', null, undefined, 1e9]) {
    assert.throws(() => buildAdgroup(ACC, 'cmp', 'g', bid), invariant('bidAmt'), `adgroup bid ${String(bid)}`);
    assert.throws(() => buildKeyword(ACC, 'grp', 'k', bid), invariant('bidAmt'), `keyword bid ${String(bid)}`);
  }
  assert.equal(buildAdgroup(ACC, 'cmp', 'g', 70).bidAmt, 70);
  assert.equal(buildKeyword(ACC, 'grp', 'k', 2000).bidAmt, 2000);
  // maxBid 자체가 상한 100,000을 넘을 수 없으므로 최댓값은 100,000
  assert.equal(buildKeyword(acc({ maxBidKrw: 100000 }), 'grp', 'k', 100000).bidAmt, 100000);
});

test('invalid account caps throw', () => {
  const bad = [
    ['dailyCapKrw', [0, -1, 1.5, NaN, Infinity, '100000', null, 100001]],
    ['sharedBudgetKrw', [0, -1, 1.5, NaN, Infinity, '90000', null]],
    ['maxBidKrw', [69, 100001, 1.5, NaN, '2000', null]],
  ];
  for (const [field, values] of bad) {
    for (const v of values) {
      const a = acc({ [field]: v });
      assert.throws(() => buildSharedBudget(a), invariant(field), `${field}=${String(v)} sharedBudget`);
      assert.throws(() => buildCampaign(a, 'c'), invariant(field), `${field}=${String(v)} campaign`);
      assert.throws(() => buildAdgroup(a, 'cmp', 'g', 100), invariant(field), `${field}=${String(v)} adgroup`);
      assert.throws(() => buildKeyword(a, 'grp', 'k', 100), invariant(field), `${field}=${String(v)} keyword`);
    }
  }
  assert.throws(() => buildCampaign(null, 'c'), invariant('account'));
});

test('caller override of aiAdsOptIn/useExpSearch/sharedBudgetId is rejected', () => {
  const cases = [
    ['campaign', o => buildCampaign(ACC, 'c', o), { sharedBudgetId: 'sb-other', useDailyBudget: false, dailyBudget: 100001, userLock: false }],
    ['adgroup', o => buildAdgroup(ACC, 'cmp', 'g', 100, o), { aiAdsOptIn: true, useExpSearch: true, useDailyBudget: false, dailyBudget: 50000, userLock: false }],
    ['keyword', o => buildKeyword(ACC, 'grp', 'k', 100, o), { useGroupBidAmt: true, userLock: false }],
    ['ad', o => buildTextAd('grp', AD, o), { userLock: false }],
  ];
  for (const [kind, build, overrides] of cases) {
    for (const [field, value] of Object.entries(overrides)) {
      assert.throws(() => build({ [field]: value }), invariant(field), `${kind}.${field}=${String(value)}`);
    }
  }
  // 확장검색 관련·미지정 필드는 덮어쓰기 경로가 아예 없다(알 수 없는 키도 거부)
  assert.throws(() => buildAdgroup(ACC, 'cmp', 'g', 100, { expSearchBudgetRatio: 0 }), invariant('expSearchBudgetRatio'));
  assert.throws(() => buildAdgroup(ACC, 'cmp', 'g', 100, { sharedBudgetId: 'sb-1' }), invariant('sharedBudgetId'));
  assert.throws(() => buildCampaign(ACC, 'c', { campaignTp: 'SHOPPING' }), invariant('campaignTp'));
  // 허용 목록 밖의 키는 값이 같거나 undefined여도 거부(passthrough 통로가 아님)
  assert.throws(() => buildCampaign(ACC, 'c', { name: 'c' }), invariant('name'));
  assert.throws(() => buildAdgroup(ACC, 'cmp', 'g', 100, { expSearchBudgetRatio: undefined }), invariant('expSearchBudgetRatio'));
  assert.throws(() => buildAdgroup(ACC, 'cmp', 'g', 100, []), invariant('declared'));
  // 같은 값을 명시하는 것은 허용(약화가 아님)
  assert.equal(buildAdgroup(ACC, 'cmp', 'g', 100, { aiAdsOptIn: false, useExpSearch: false, userLock: true }).aiAdsOptIn, false);
  assert.equal(buildCampaign(ACC, 'c', { sharedBudgetId: 'sb-1', dailyBudget: 90000 }).sharedBudgetId, 'sb-1');
});

test('missing sharedBudgetId or businessChannelId throws', () => {
  for (const v of [null, undefined, '', '   ']) {
    assert.throws(() => buildCampaign(acc({ sharedBudgetId: v }), 'c'), invariant('sharedBudgetId'));
    assert.throws(() => buildAdgroup(acc({ businessChannelId: v }), 'cmp', 'g', 100), invariant('businessChannelId'));
  }
  // 공유예산 생성 자체는 sharedBudgetId가 없을 때 하는 일이므로 막지 않는다
  assert.equal(buildSharedBudget(acc({ sharedBudgetId: null })).dailyBudget, 90000);
});

test('required identifiers and ad fields are validated', () => {
  assert.throws(() => buildCampaign(ACC, ''), invariant('name'));
  assert.throws(() => buildAdgroup(ACC, '', 'g', 100), invariant('nccCampaignId'));
  assert.throws(() => buildAdgroup(ACC, 'cmp', '', 100), invariant('name'));
  assert.throws(() => buildKeyword(ACC, '', 'k', 100), invariant('nccAdgroupId'));
  assert.throws(() => buildKeyword(ACC, 'grp', ' ', 100), invariant('keyword'));
  assert.throws(() => buildTextAd('', AD), invariant('nccAdgroupId'));
  assert.throws(() => buildTextAd('grp', { ...AD, headline: '' }), invariant('ad.headline'));
  assert.throws(() => buildTextAd('grp', { ...AD, description: undefined }), invariant('ad.description'));
  assert.throws(() => buildTextAd('grp', { ...AD, pcUrl: 'javascript:alert(1)' }), invariant('ad.pc.final'));
  assert.throws(() => buildTextAd('grp', { ...AD, mobileUrl: 'not a url' }), invariant('ad.mobile.final'));
});

test('assertInvariants rejects any weakened body', () => {
  const bodies = {
    sharedBudget: buildSharedBudget(ACC),
    campaign: buildCampaign(ACC, 'c'),
    adgroup: buildAdgroup(ACC, 'cmp', 'g', 100),
    keyword: buildKeyword(ACC, 'grp', 'k', 100),
    ad: buildTextAd('grp', AD),
  };
  for (const [kind, body] of Object.entries(bodies)) assert.doesNotThrow(() => assertInvariants(kind, ACC, body), kind);
  const drifts = [
    ['sharedBudget', { dailyBudget: 100001 }, 'dailyBudget'],
    ['sharedBudget', { dailyBudget: 0 }, 'dailyBudget'],
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
    assert.throws(() => assertInvariants(kind, ACC, { ...bodies[kind], ...patch }), invariant(field), `${kind} ${JSON.stringify(patch)}`);
  }
  // 그룹 입찰을 쓰는 키워드는 키워드 bidAmt를 보지 않는다(그룹 bidAmt가 상한을 지킨다)
  assert.doesNotThrow(() => assertInvariants('keyword', ACC, { ...bodies.keyword, useGroupBidAmt: true, bidAmt: 999999 }));
  assert.throws(() => assertInvariants('campaign', ACC, null), invariant('body'));
  assert.throws(() => assertInvariants('nope', ACC, {}), invariant('kind'));
  assert.throws(() => assertInvariants('campaign', acc({ dailyCapKrw: 0 }), bodies.campaign), invariant('dailyCapKrw'));
});

test('assertInvariants allowUnlock permits only the userLock relaxation', () => {
  const unlocked = { ...buildCampaign(ACC, 'c'), userLock: false };
  assert.doesNotThrow(() => assertInvariants('campaign', ACC, unlocked, { allowUnlock: true }));
  assert.throws(() => assertInvariants('campaign', ACC, { ...unlocked, useDailyBudget: false }, { allowUnlock: true }), invariant('useDailyBudget'));
  assert.throws(() => assertInvariants('campaign', ACC, { ...unlocked, userLock: 'false' }, { allowUnlock: true }), invariant('userLock'));
});

// 네이버에 실제 저장된 값(재조회 GET 응답) 예시. 추가 필드는 무시된다.
const STORED = {
  campaign: { nccCampaignId: 'cmp-1', name: 'c', sharedBudgetId: 'sb-1', useDailyBudget: true, dailyBudget: 90000, extra: { x: 1 } },
  adgroup: { nccAdgroupId: 'grp-1', aiAdsOptIn: false, useExpSearch: false, useDailyBudget: true, dailyBudget: 90000, bidAmt: 500, expSearchBudgetRatio: 100 },
  keyword: { nccKeywordId: 'kw-1', useGroupBidAmt: false, bidAmt: 300 },
  sharedBudget: { dailyBudget: 90000 },
};

test('verifyStored accepts stored values that honour the invariants', () => {
  for (const [kind, stored] of Object.entries(STORED)) assert.deepEqual(verifyStored(kind, ACC, stored), { ok: true }, kind);
  assert.deepEqual(verifyStored('keyword', ACC, { useGroupBidAmt: true, bidAmt: 999999 }), { ok: true });
  assert.deepEqual(verifyStored('campaign', ACC, { ...STORED.campaign, dailyBudget: 100000 }), { ok: true });
});

test('verifyStored flags each drifted field', () => {
  const drifts = [
    ['campaign', { sharedBudgetId: 'sb-other' }, 'sharedBudgetId'],
    ['campaign', { useDailyBudget: false }, 'useDailyBudget'],
    ['campaign', { dailyBudget: 100001 }, 'dailyBudget'],
    ['campaign', { dailyBudget: 0 }, 'dailyBudget'],
    ['adgroup', { aiAdsOptIn: true }, 'aiAdsOptIn'],
    ['adgroup', { useExpSearch: true }, 'useExpSearch'],
    ['adgroup', { useDailyBudget: false }, 'useDailyBudget'],
    ['adgroup', { dailyBudget: 100001 }, 'dailyBudget'],
    ['adgroup', { bidAmt: 2001 }, 'bidAmt'],
    ['adgroup', { bidAmt: 69 }, 'bidAmt'],
    ['keyword', { bidAmt: 2001 }, 'bidAmt'],
    ['keyword', { bidAmt: 69 }, 'bidAmt'],
    ['sharedBudget', { dailyBudget: 100001 }, 'dailyBudget'],
  ];
  for (const [kind, patch, field] of drifts) {
    assert.deepEqual(verifyStored(kind, ACC, { ...STORED[kind], ...patch }), { ok: false, field }, `${kind} ${JSON.stringify(patch)}`);
  }
});

test('verifyStored never returns ok on an unparseable shape', () => {
  const shapes = [
    ['campaign', null], ['campaign', 'x'], ['campaign', []], ['campaign', {}],
    ['campaign', { ...STORED.campaign, sharedBudgetId: undefined }],
    ['campaign', { ...STORED.campaign, sharedBudgetId: null }],
    ['campaign', { ...STORED.campaign, useDailyBudget: 'true' }],
    ['campaign', { ...STORED.campaign, dailyBudget: '90000' }],
    ['campaign', { ...STORED.campaign, dailyBudget: undefined }],
    ['adgroup', { ...STORED.adgroup, aiAdsOptIn: undefined }],
    ['adgroup', { ...STORED.adgroup, useExpSearch: null }],
    ['adgroup', { ...STORED.adgroup, bidAmt: '500' }],
    ['adgroup', { ...STORED.adgroup, bidAmt: NaN }],
    ['adgroup', { ...STORED.adgroup, useDailyBudget: undefined }],
    ['keyword', { useGroupBidAmt: false }],
    ['keyword', { bidAmt: 300 }],
    ['sharedBudget', {}],
  ];
  for (const [kind, stored] of shapes) {
    assert.deepEqual(verifyStored(kind, ACC, stored), { ok: false, field: 'shape' }, `${kind} ${JSON.stringify(stored)}`);
  }
  assert.deepEqual(verifyStored('ad', ACC, {}), { ok: false, field: 'kind' });
  assert.deepEqual(verifyStored('campaign', acc({ sharedBudgetId: null }), STORED.campaign), { ok: false, field: 'sharedBudgetId' });
  assert.deepEqual(verifyStored('campaign', acc({ dailyCapKrw: NaN }), STORED.campaign), { ok: false, field: 'dailyCapKrw' });
});
