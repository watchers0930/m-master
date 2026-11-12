/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require */
// 상한 불변식 요청 빌더: 하루 상한·ADVoost·확장검색·입찰배수·자동입찰·잠금 강제, 호출자 덮어쓰기 거부, 끄기/켜기 최소 본문.
// 네트워크·DB 없음. 순수 함수만 검사한다. (assertInvariants·verifyStored는 requests-verify.test.cjs)
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSharedBudget, buildCampaign, buildAdgroup, buildKeyword, buildTextAd, buildPause, buildResume,
  assertInvariants, AdsInvariantError,
} = require('../requests.ts');

const ACC = Object.freeze({ naverCustomerId: '1234567', dailyCapKrw: 10000, sharedBudgetKrw: 9000, maxBidKrw: 2000, sharedBudgetId: 'sb-1', businessChannelId: 'bsn-1' });
const acc = (patch = {}) => ({ ...ACC, ...patch });
const invariant = field => e => {
  assert.ok(e instanceof AdsInvariantError, `AdsInvariantError expected, got ${e && e.name}: ${e && e.message}`);
  assert.equal(e.field, field);
  return true;
};
const CAMP = { nccCampaignId: 'cmp-1', name: 'mq-p1' };
const AD = { headline: '전세 사기 확인', description: '등기부 위험도를 1분 만에 확인하세요', pcUrl: 'https://vestra.ai.kr', mobileUrl: 'https://vestra.ai.kr/m' };

test('builders always emit safety fields (spec create shapes)', () => {
  assert.deepEqual(buildSharedBudget(ACC, CAMP), {
    customerId: 1234567, name: 'mq-cap', ownerType: 'CAMPAIGN', deliveryMethod: 'ACCELERATED', dailyBudget: 9000,
    campaignList: [{ nccCampaignId: 'cmp-1', customerId: 1234567, name: 'mq-p1', campaignTp: 'WEB_SITE' }],
  });
  assert.deepEqual(buildCampaign(ACC, 'mq-p1'), {
    customerId: 1234567, name: 'mq-p1', campaignTp: 'WEB_SITE', useDailyBudget: true, dailyBudget: 9000, userLock: true,
  });
  assert.deepEqual(buildAdgroup(ACC, 'cmp-1', 'mq-p1-g1', 500), {
    nccCampaignId: 'cmp-1', name: 'mq-p1-g1', adgroupType: 'WEB_SITE', pcChannelId: 'bsn-1', mobileChannelId: 'bsn-1',
    bidAmt: 500, pcNetworkBidWeight: 100, mobileNetworkBidWeight: 100, useCntsNetworkBidAmt: false, systemBiddingType: 'NONE',
    useDailyBudget: true, dailyBudget: 9000, aiAdsOptIn: false, useExpSearch: false, userLock: true,
  });
  // 명세: POST /ncc/keywords?nccAdgroupId=… 본문은 KeywordRequest 배열, nccAdgroupId는 #hidden-create(쿼리로만)
  assert.deepEqual(buildKeyword(ACC, 'grp-1', '전세사기', 300), {
    query: { nccAdgroupId: 'grp-1' },
    body: [{ keyword: '전세사기', bidAmt: 300, useGroupBidAmt: false, userLock: true }],
  });
  assert.deepEqual(buildTextAd('grp-1', AD), {
    nccAdgroupId: 'grp-1', type: 'TEXT_45', userLock: true,
    ad: { headline: AD.headline, description: AD.description, pc: { final: AD.pcUrl }, mobile: { final: AD.mobileUrl } },
  });
});

test('dailyBudget is min(sharedBudgetKrw, dailyCapKrw) for shared budget, campaign and adgroup', () => {
  const a = acc({ dailyCapKrw: 8000, sharedBudgetKrw: 10000 });
  assert.equal(buildSharedBudget(a, CAMP).dailyBudget, 8000);
  assert.equal(buildCampaign(a, 'c').dailyBudget, 8000);
  assert.equal(buildAdgroup(a, 'cmp', 'g', 100).dailyBudget, 8000);
});

test('bid outside 70..maxBid throws', () => {
  for (const bid of [69, 0, -1, 2001, 10001, 70.5, NaN, Infinity, -Infinity, '500', null, undefined, 1e9]) {
    assert.throws(() => buildAdgroup(ACC, 'cmp', 'g', bid), invariant('bidAmt'), `adgroup bid ${String(bid)}`);
    assert.throws(() => buildKeyword(ACC, 'grp', 'k', bid), invariant('bidAmt'), `keyword bid ${String(bid)}`);
  }
  assert.equal(buildAdgroup(ACC, 'cmp', 'g', 70).bidAmt, 70);
  assert.equal(buildKeyword(ACC, 'grp', 'k', 2000).body[0].bidAmt, 2000);
  assert.equal(buildKeyword(acc({ maxBidKrw: 10000 }), 'grp', 'k', 10000).body[0].bidAmt, 10000);
});

test('invalid account caps and customer id throw', () => {
  const bad = [
    ['dailyCapKrw', [0, -1, 1.5, NaN, Infinity, '10000', null, 10001]],
    ['sharedBudgetKrw', [0, -1, 1.5, NaN, Infinity, '9000', null]],
    ['maxBidKrw', [69, 10001, 1.5, NaN, '2000', null]],
  ];
  for (const [field, values] of bad) {
    for (const v of values) {
      const a = acc({ [field]: v });
      assert.throws(() => buildSharedBudget(a, CAMP), invariant(field), `${field}=${String(v)} sharedBudget`);
      assert.throws(() => buildCampaign(a, 'c'), invariant(field), `${field}=${String(v)} campaign`);
      assert.throws(() => buildAdgroup(a, 'cmp', 'g', 100), invariant(field), `${field}=${String(v)} adgroup`);
      assert.throws(() => buildKeyword(a, 'grp', 'k', 100), invariant(field), `${field}=${String(v)} keyword`);
    }
  }
  for (const v of [null, undefined, '', ' 123', '12a', '0', '-5', '1.5', '99999999999999999999', 1234567]) {
    assert.throws(() => buildSharedBudget(acc({ naverCustomerId: v }), CAMP), invariant('naverCustomerId'), `customer ${String(v)} sharedBudget`);
    assert.throws(() => buildCampaign(acc({ naverCustomerId: v }), 'c'), invariant('naverCustomerId'), `customer ${String(v)} campaign`);
  }
  assert.throws(() => buildCampaign(null, 'c'), invariant('account'));
});

test('caller override of aiAdsOptIn/useExpSearch/sharedBudgetId is rejected', () => {
  const cases = [
    ['campaign', o => buildCampaign(ACC, 'c', o), { sharedBudgetId: 'sb-other', useDailyBudget: false, dailyBudget: 10001, userLock: false }],
    ['adgroup', o => buildAdgroup(ACC, 'cmp', 'g', 100, o), {
      aiAdsOptIn: true, useExpSearch: true, useDailyBudget: false, dailyBudget: 5000, userLock: false,
      pcNetworkBidWeight: 500, mobileNetworkBidWeight: 200, useCntsNetworkBidAmt: true, systemBiddingType: 'ML',
    }],
    ['keyword', o => buildKeyword(ACC, 'grp', 'k', 100, o), { useGroupBidAmt: true, userLock: false }],
    ['ad', o => buildTextAd('grp', AD, o), { userLock: false }],
  ];
  for (const [kind, build, overrides] of cases) {
    for (const [field, value] of Object.entries(overrides)) {
      assert.throws(() => build({ [field]: value }), invariant(field), `${kind}.${field}=${String(value)}`);
    }
  }
  assert.throws(() => buildAdgroup(ACC, 'cmp', 'g', 100, { expSearchBudgetRatio: 0 }), invariant('expSearchBudgetRatio'));
  assert.throws(() => buildAdgroup(ACC, 'cmp', 'g', 100, { sharedBudgetId: 'sb-1' }), invariant('sharedBudgetId'));
  assert.throws(() => buildCampaign(ACC, 'c', { campaignTp: 'SHOPPING' }), invariant('campaignTp'));
  assert.throws(() => buildCampaign(ACC, 'c', { customerId: 1 }), invariant('customerId'));
  // 허용 목록 밖의 키는 값이 같거나 undefined여도 거부(passthrough 통로가 아님)
  assert.throws(() => buildCampaign(ACC, 'c', { name: 'c' }), invariant('name'));
  assert.throws(() => buildAdgroup(ACC, 'cmp', 'g', 100, { expSearchBudgetRatio: undefined }), invariant('expSearchBudgetRatio'));
  assert.throws(() => buildAdgroup(ACC, 'cmp', 'g', 100, []), invariant('declared'));
  // 같은 값을 명시하는 것은 허용(약화가 아님)
  assert.equal(buildAdgroup(ACC, 'cmp', 'g', 100, { aiAdsOptIn: false, useExpSearch: false, userLock: true, systemBiddingType: 'NONE' }).aiAdsOptIn, false);
  assert.equal(buildCampaign(ACC, 'c', { useDailyBudget: true, dailyBudget: 9000 }).dailyBudget, 9000);
});

test('missing businessChannelId throws; campaign and shared budget create need no sharedBudgetId (hotfix 2026-11-11)', () => {
  for (const v of [null, undefined, '', '   ']) {
    assert.equal(buildCampaign(acc({ sharedBudgetId: v }), 'c').dailyBudget, 9000, '첫 캠페인은 공유예산 없이 만든다');
    assert.throws(() => buildAdgroup(acc({ businessChannelId: v }), 'cmp', 'g', 100), invariant('businessChannelId'));
  }
  // 공유예산 생성 자체는 sharedBudgetId가 없을 때 하는 일이므로 막지 않는다
  assert.equal(buildSharedBudget(acc({ sharedBudgetId: null }), CAMP).dailyBudget, 9000);
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

const PAUSE_KINDS = [['campaign', 'nccCampaignId'], ['adgroup', 'nccAdgroupId'], ['keyword', 'nccKeywordId'], ['ad', 'nccAdId']];
// 상한이 깨진 상태(가장 멈춰야 할 때)의 계정 행들
const DRIFTED_ACCOUNTS = {
  'shared budget unlinked': acc({ sharedBudgetId: null }),
  'cap lowered below stored budget': acc({ dailyCapKrw: 5000 }),
  'broken row (null caps, null ids)': { naverCustomerId: null, dailyCapKrw: null, sharedBudgetKrw: null, maxBidKrw: null, sharedBudgetId: null, businessChannelId: null },
  'no account': null,
};

test('pause is never blocked: minimal body for every kind and every drift state', () => {
  for (const [kind, idField] of PAUSE_KINDS) {
    const body = buildPause(kind, 'id-1');
    assert.deepEqual(body, { [idField]: 'id-1', userLock: true }, kind);
    for (const [state, account] of Object.entries(DRIFTED_ACCOUNTS)) {
      assert.doesNotThrow(() => assertInvariants('pause', account, body), `${kind} / ${state}`);
    }
  }
  // 공유예산 해제·하루예산 off·ADVoost on 상태의 엔티티도 같은 최소 본문으로 끈다(GET 본문 전체를 되돌려 보내지 않음)
  assert.throws(() => buildPause('sharedBudget', 'sb-1'), invariant('kind'));
  assert.throws(() => buildPause('campaign', ''), invariant('nccCampaignId'));
});

test('pause assert checks only userLock===true and id-only keys', () => {
  const ok = { nccCampaignId: 'c-1', userLock: true };
  assert.throws(() => assertInvariants('pause', ACC, { ...ok, userLock: false }), invariant('userLock'));
  assert.throws(() => assertInvariants('pause', ACC, { ...ok, userLock: 'true' }), invariant('userLock'));
  assert.throws(() => assertInvariants('pause', ACC, { ...ok, aiAdsOptIn: false }), invariant('aiAdsOptIn'));
  assert.throws(() => assertInvariants('pause', ACC, { ...ok, dailyBudget: 1 }), invariant('dailyBudget'));
  assert.throws(() => assertInvariants('pause', ACC, { ...ok, sharedBudgetId: 'sb-x' }), invariant('sharedBudgetId'));
  assert.throws(() => assertInvariants('resume', ACC, { ...ok, userLock: false, systemBiddingType: 'ML' }), invariant('systemBiddingType'));
  assert.throws(() => assertInvariants('pause', ACC, { ...ok, nccAdgroupId: 'g-1' }), invariant('nccAdgroupId'));
  assert.throws(() => assertInvariants('pause', ACC, { userLock: true }), invariant('id'));
  assert.throws(() => assertInvariants('pause', ACC, { nccCampaignId: '', userLock: true }), invariant('nccCampaignId'));
  assert.throws(() => assertInvariants('pause', ACC, null), invariant('body'));
});

test('resume only via buildResume with an allowed reason; create bodies can never be unlocked', () => {
  for (const [kind, idField] of PAUSE_KINDS) {
    for (const reason of ['owner_approved', 'guard_auto_resume']) {
      const body = buildResume(kind, 'id-1', reason);
      assert.deepEqual(body, { [idField]: 'id-1', userLock: false }, `${kind} ${reason}`);
      assert.doesNotThrow(() => assertInvariants('resume', ACC, body));
    }
    for (const reason of [undefined, '', 'admin', 'OWNER_APPROVED', true]) {
      assert.throws(() => buildResume(kind, 'id-1', reason), invariant('reason'), `${kind} ${String(reason)}`);
    }
  }
  assert.throws(() => assertInvariants('resume', ACC, { nccCampaignId: 'c', userLock: true }), invariant('userLock'));
  assert.throws(() => assertInvariants('resume', ACC, { nccCampaignId: 'c', userLock: false, useDailyBudget: false }), invariant('useDailyBudget'));
  // allowUnlock 같은 완화 옵션은 없다: 생성 본문은 4번째 인자와 무관하게 userLock:true만 통과
  const unlocked = { ...buildCampaign(ACC, 'c'), userLock: false };
  assert.throws(() => assertInvariants('campaign', ACC, unlocked, { allowUnlock: true }), invariant('userLock'));
  assert.throws(() => assertInvariants('adgroup', ACC, { ...buildAdgroup(ACC, 'cmp', 'g', 100), userLock: false }, { allowUnlock: true }), invariant('userLock'));
});

test('campaign·adgroup·shared-budget names over 30 chars throw before Naver (실운영 400/3711, 2026-11-12)', () => {
  const at30 = 'x'.repeat(30), over = 'x'.repeat(31), ko31 = '가'.repeat(31);
  assert.equal(buildCampaign(ACC, at30).name, at30);
  assert.equal(buildAdgroup(ACC, 'cmp', at30, 100).name, at30);
  assert.equal(buildSharedBudget(ACC, { nccCampaignId: 'cmp-1', name: at30 }).campaignList[0].name, at30);
  for (const name of [over, ko31]) {
    assert.throws(() => buildCampaign(ACC, name), invariant('name'), `campaign ${name.length}`);
    assert.throws(() => buildAdgroup(ACC, 'cmp', name, 100), invariant('name'), `adgroup ${name.length}`);
    assert.throws(() => buildSharedBudget(ACC, { nccCampaignId: 'cmp-1', name }), invariant('name'), `shared budget ${name.length}`);
  }
});

test('generated adgroup names fit the limit for a real cuid proposal id (25 chars) up to MAX_GROUPS', () => {
  const { adgroupName, campaignName } = require('../names.ts');
  const { MAX_GROUPS } = require('../../../schemas/ads-proposal.ts');
  const id = 'cmwd46bxi0003lb07v0bl194h';
  assert.equal(id.length, 25);
  assert.equal(buildCampaign(ACC, campaignName(id)).name, `mq-${id}`);
  for (let n = 1; n <= MAX_GROUPS; n++) {
    const name = adgroupName(id, n);
    assert.equal(name, `${id}-g${n}`);
    assert.equal(buildAdgroup(ACC, 'cmp', name, 100).name, name);
  }
});
