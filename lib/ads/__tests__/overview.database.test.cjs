/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 광고 계정 개요(GET /api/ads/accounts/[id]/overview, Task 12) — 실DB(PGlite). 네이버는 부르지 않는다(DB만 읽음).
// - 소유자 범위: 남의 계정·형식 틀린 id·허용목록 밖은 404(IDOR). 응답엔 keyLast4만(키 원문·암호문·필드명 없음), no-store.
// - 감시 스냅샷(lastGuardAt·lastSpendKrw·lastBizmoneyKrw)과 그 나이(분). 없으면 null.
// - 미러 4종(lockedBy·inspectStatus·userLock·lockVersion), 캠페인별 7·30일 합계(KST 날짜, 오늘 포함), 일별 추이.
// - N+1 없음: 표마다 쿼리 1회(캠페인 수와 무관).
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupAdsDb, request } = require('./fixtures/ads-db.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;

const NOW = new Date('2026-03-10T03:00:00Z'); // KST 2026-03-10 12:00
const day = (offset) => new Date(Date.parse('2026-03-10T00:00:00Z') - offset * 86_400_000); // KST 날짜(00:00Z로 저장)
const BLOB = 'v1:0123456789abcdef:SEALEDCIPHERTEXT';

test('ads account overview on a real database', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async (t) => {
  const env = await setupAdsDb(packageDir);
  try {
    const { client, session } = env;
    const route = require('../../../app/api/ads/accounts/[id]/overview/route.ts');
    const { getOverview } = require('../overview.ts');
    const get = async (id) => {
      const res = await route.GET(request('GET', `/api/ads/accounts/${id}/overview`), { params: Promise.resolve({ id }) });
      const text = await res.text();
      return { status: res.status, text, body: JSON.parse(text), cache: res.headers.get('cache-control') };
    };
    const acc = await client.adAccount.create({ data: {
      ownerId: 'owner', naverCustomerId: '1234567', label: '베스트라', apiKeyEnc: BLOB, secretKeyEnc: BLOB + 'S', keyLast4: '1a2b',
      sharedBudgetId: 'sb-1', businessChannelId: 'bsn-1',
    } });
    const theirs = await client.adAccount.create({ data: { ownerId: 'other', naverCustomerId: '7654321', label: '남의 계정', apiKeyEnc: BLOB, secretKeyEnc: BLOB, keyLast4: 'zzzz' } });
    const m = (naverId, extra = {}) => ({ ownerId: 'owner', adAccountId: acc.id, naverId, name: `mq-${naverId}`, ...extra });
    await client.adCampaign.createMany({ data: [
      m('cmp-1', { userLock: false, lockedBy: null, lockVersion: 3 }), m('cmp-2', { lockedBy: 'guard', lockedAt: NOW, lockVersion: 5 }),
      m('cmp-3', { lockedBy: 'pending_launch' }),
    ] });
    await client.adCampaign.create({ data: { ownerId: 'other', adAccountId: theirs.id, naverId: 'cmp-x', name: 'x' } });
    await client.adGroup.create({ data: m('grp-1', { parentNaverId: 'cmp-1', bidAmt: 300, lockedBy: 'owner' }) });
    await client.adKeyword.create({ data: m('kw-1', { parentNaverId: 'grp-1', keyword: '전세사기', bidAmt: 300, inspectStatus: 'UNDER_REVIEW' }) });
    await client.adCreative.create({ data: m('ad-1', { parentNaverId: 'grp-1', slot: 'a1', headline: '등기부 확인', description: '계약 전 점검', inspectStatus: 'APPROVED' }) });
    const perf = (naverId, offset, cost, extra = {}) =>
      ({ ownerId: 'owner', adAccountId: acc.id, entityType: 'campaign', naverId, date: day(offset), impCnt: 100, clkCnt: 10, costKrw: cost, ccnt: 0, ...extra });
    await client.adPerformanceDaily.createMany({ data: [
      perf('cmp-1', 0, 1000), perf('cmp-1', 6, 2000, { ccnt: 1 }), perf('cmp-1', 7, 4000), perf('cmp-1', 29, 8000), perf('cmp-1', 30, 16000),
      perf('cmp-2', 1, 500),
      perf('grp-1', 0, 99999, { entityType: 'adgroup' }), // 캠페인 합계에 섞이지 않는다
    ] });
    await client.adPerformanceDaily.create({ data: { ...perf('cmp-x', 0, 77777), ownerId: 'other', adAccountId: theirs.id } });

    await t.test('IDOR and allowlist: other owner, bad id, outsider are 404', async () => {
      assert.equal((await get(theirs.id)).status, 404);
      assert.equal((await get('not a cuid!')).status, 404);
      session.user = 'outsider';
      try { assert.equal((await get(acc.id)).status, 404); } finally { session.user = 'owner'; }
      session.user = null;
      try { assert.equal((await get(acc.id)).status, 401); } finally { session.user = 'owner'; }
      await assert.rejects(getOverview('other', acc.id, NOW), (e) => e.status === 404);
    });

    await t.test('DTO carries keyLast4 only, no key material, no-store', async () => {
      const r = await get(acc.id);
      assert.equal(r.status, 200);
      assert.equal(r.cache, 'no-store');
      for (const needle of [BLOB, 'v1:', 'apiKeyEnc', 'secretKeyEnc', 'api_key_enc', 'secret_key_enc', 'SEALED'])
        assert.equal(r.text.includes(needle), false, `leaks ${needle}`);
      const a = r.body.data.account;
      assert.equal(a.keyLast4, '1a2b');
      assert.equal(a.connected, true);
      assert.deepEqual(Object.keys(a).sort(), ['businessChannelId', 'connected', 'createdAt', 'dailyCapKrw', 'disconnectStuck', 'id', 'keyLast4', 'label', 'lastVerifiedAt', 'maxBidKrw', 'naverCustomerId', 'sharedBudgetId', 'sharedBudgetKrw', 'status']);
      assert.equal(r.text.includes('cmp-x'), false, '남의 미러·성과 없음');
    });

    await t.test('guard snapshot: null before the first guard run, then value and age in minutes', async () => {
      const before = await getOverview('owner', acc.id, NOW);
      assert.deepEqual(before.snapshot, { at: null, ageMinutes: null, spendKrw: null, bizmoneyKrw: null });
      await client.adAccount.update({ where: { id: acc.id }, data: { lastGuardAt: new Date(NOW.getTime() - 12 * 60_000 - 30_000), lastSpendKrw: 45000, lastBizmoneyKrw: 2500000 } });
      const after = await getOverview('owner', acc.id, NOW);
      assert.deepEqual(after.snapshot, { at: new Date(NOW.getTime() - 750_000).toISOString(), ageMinutes: 12, spendKrw: 45000, bizmoneyKrw: 2500000 });
      // 비용을 모름(null)은 0으로 바뀌지 않는다
      await client.adAccount.update({ where: { id: acc.id }, data: { lastSpendKrw: null } });
      assert.equal((await getOverview('owner', acc.id, NOW)).snapshot.spendKrw, null);
      // 미래 시각(시계 어긋남)은 0분
      await client.adAccount.update({ where: { id: acc.id }, data: { lastGuardAt: new Date(NOW.getTime() + 60_000) } });
      assert.equal((await getOverview('owner', acc.id, NOW)).snapshot.ageMinutes, 0);
    });

    await t.test('mirrors carry lock and inspection state', async () => {
      const o = await getOverview('owner', acc.id, NOW);
      const c = Object.fromEntries(o.campaigns.map((x) => [x.naverId, x]));
      assert.deepEqual(Object.keys(c).sort(), ['cmp-1', 'cmp-2', 'cmp-3']);
      assert.deepEqual([c['cmp-1'].userLock, c['cmp-1'].lockedBy, c['cmp-1'].lockVersion], [false, null, 3]);
      assert.deepEqual([c['cmp-2'].lockedBy, c['cmp-2'].lockVersion, c['cmp-2'].lockedAt], ['guard', 5, NOW.toISOString()]);
      assert.equal(c['cmp-3'].lockedBy, 'pending_launch');
      assert.deepEqual([o.groups[0].naverId, o.groups[0].parentNaverId, o.groups[0].bidAmt, o.groups[0].lockedBy], ['grp-1', 'cmp-1', 300, 'owner']);
      assert.deepEqual([o.keywords[0].keyword, o.keywords[0].inspectStatus, o.keywords[0].parentNaverId], ['전세사기', 'UNDER_REVIEW', 'grp-1']);
      assert.deepEqual([o.ads[0].headline, o.ads[0].slot, o.ads[0].inspectStatus], ['등기부 확인', 'a1', 'APPROVED']);
      assert.deepEqual(o.truncated, { campaigns: false, groups: false, keywords: false, ads: false });
    });

    await t.test('7/30-day aggregation per campaign (KST dates, today inclusive) and daily trend', async () => {
      const o = await getOverview('owner', acc.id, NOW);
      const p = Object.fromEntries(o.performance.campaigns.map((x) => [x.naverId, x]));
      assert.deepEqual(p['cmp-1'].days7, { impCnt: 200, clkCnt: 20, costKrw: 3000, ccnt: 1 }, 'D-0, D-6 (D-7 제외)');
      assert.deepEqual(p['cmp-1'].days30, { impCnt: 400, clkCnt: 40, costKrw: 15000, ccnt: 1 }, 'D-0..D-29 (D-30 제외)');
      assert.deepEqual(p['cmp-2'].days7, { impCnt: 100, clkCnt: 10, costKrw: 500, ccnt: 0 });
      assert.equal(p['cmp-3'], undefined, '성과 없는 캠페인은 행 없음');
      assert.deepEqual(o.performance.totals7, { impCnt: 300, clkCnt: 30, costKrw: 3500, ccnt: 1 });
      assert.deepEqual(o.performance.totals30, { impCnt: 500, clkCnt: 50, costKrw: 15500, ccnt: 1 });
      assert.deepEqual([o.performance.since7, o.performance.since30], ['2026-03-04', '2026-02-09']);
      assert.deepEqual(o.performance.daily.map((d) => [d.date, d.costKrw]), [['2026-02-09', 8000], ['2026-03-03', 4000], ['2026-03-04', 2000], ['2026-03-09', 500], ['2026-03-10', 1000]]);
    });

    await t.test('no N+1: one query per table regardless of campaign count', async () => {
      await client.adCampaign.createMany({ data: Array.from({ length: 20 }, (_, i) => m(`bulk-${i}`)) });
      await client.adGroup.createMany({ data: Array.from({ length: 20 }, (_, i) => m(`bulk-g${i}`, { parentNaverId: `bulk-${i}` })) });
      await client.adPerformanceDaily.createMany({ data: Array.from({ length: 20 }, (_, i) => perf(`bulk-${i}`, 2, 10)) });
      const counts = {};
      const restore = [];
      for (const [model, methods] of Object.entries({
        adAccount: ['findFirst', 'findUnique', 'findMany'], adCampaign: ['findMany', 'findFirst'], adGroup: ['findMany', 'findFirst'],
        adKeyword: ['findMany', 'findFirst'], adCreative: ['findMany', 'findFirst'], adPerformanceDaily: ['findMany', 'groupBy', 'aggregate'],
      })) {
        for (const method of methods) {
          const d = client[model], orig = d[method];
          d[method] = (...args) => { counts[model] = (counts[model] ?? 0) + 1; return orig.apply(d, args); };
          restore.push(() => { d[method] = orig; });
        }
      }
      let o;
      try { o = await getOverview('owner', acc.id, NOW); } finally { for (const r of restore) r(); }
      assert.equal(o.campaigns.length, 23);
      assert.equal(o.performance.campaigns.length, 22);
      assert.deepEqual(counts, { adAccount: 1, adCampaign: 1, adGroup: 1, adKeyword: 1, adCreative: 1, adPerformanceDaily: 1 });
    });
  } finally {
    await env.close();
  }
});
