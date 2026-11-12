/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 제안 적용 실행기 — 실DB(PGlite) + 가짜 네이버: 일시중지 생성·pending_launch 미러·실행 순서·재조회 대조(드리프트)·
// extend_group(대상 그룹에 키워드·소재만)·비상 정지 스위치(실행 시점마다 확인). 훅은 기록·장애 주입만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupApplyEnv, PAYLOAD, EXTRA, k } = require('./fixtures/apply-env.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;

test('ads proposal apply on a real database', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async (t) => {
  const a = await setupApplyEnv(packageDir);
  const { env, naver, approved, apply, posts, puts, mirrors, proposalRow, resetFaults } = a;
  const { client } = env;
  const POST = (re) => naver.state.calls.filter((c) => c.method === 'POST' && re.test(c.path));
  try {
    await t.test('everything is created paused with pending_launch', async () => {
      const p = await approved();
      const r = await apply(p.id);
      assert.deepEqual([r.status, r.body.data.status, r.body.data.failCode ?? null], [200, 'applied', null], JSON.stringify(r.body));
      const posted = naver.state.calls.filter((c) => c.method === 'POST' && c.path.startsWith('/ncc/') && c.path !== '/ncc/shared-budgets');
      assert.deepEqual(posted.map((c) => c.path), ['/ncc/campaigns', '/ncc/adgroups', '/ncc/adgroups', '/ncc/keywords', '/ncc/keywords', '/ncc/keywords', '/ncc/ads', '/ncc/ads', '/ncc/ads', '/ncc/ads'], '캠페인 → 그룹 → 키워드 → 소재 순서');
      for (const c of posted) for (const item of [].concat(c.body)) assert.equal(item.userLock, true, `${c.path} 생성 본문 userLock=true`);
      const camp = POST(/^\/ncc\/campaigns$/)[0].body;
      assert.deepEqual([camp.name, camp.campaignTp, Object.hasOwn(camp, 'sharedBudgetId'), camp.useDailyBudget], [`mq-${p.id}`, 'WEB_SITE', false, true], '생성 본문엔 공유예산 없음(핫픽스 2026-11-11)');
      const created = naver.state.campaigns.find((c) => c.name === `mq-${p.id}`);
      assert.equal(created.sharedBudgetId, (await a.account()).sharedBudgetId, '첫 적용이 만든 mq-cap에 붙어 있다');
      const groups = POST(/^\/ncc\/adgroups$/).map((c) => c.body);
      assert.deepEqual(groups.map((g) => [g.name, g.bidAmt, g.aiAdsOptIn, g.useExpSearch]), [[`${p.id}-g1`, 300, false, false], [`${p.id}-g2`, 250, false, false]]);
      const kwCalls = POST(/^\/ncc\/keywords$/);
      assert.ok(kwCalls.every((c) => Array.isArray(c.body) && c.body.length === 1 && c.query.nccAdgroupId), 'POST ?nccAdgroupId + 배열 본문');
      // 네이버 상태: 전부 꺼짐
      for (const list of [naver.state.campaigns, naver.state.adgroups, naver.state.keywords, naver.state.ads]) assert.ok(list.length > 0 && list.every((x) => x.userLock === true));
      const m = await mirrors(p.id);
      assert.deepEqual([m.campaigns.length, m.groups.length, m.keywords.length, m.creatives.length], [1, 2, 3, 4]);
      for (const row of [...m.campaigns, ...m.groups, ...m.keywords, ...m.creatives]) {
        assert.deepEqual([row.userLock, row.lockedBy, row.lockVersion, row.ownerId, row.adAccountId], [true, 'pending_launch', 0, 'owner', a.accountId]);
      }
      assert.deepEqual(m.creatives.map((c) => c.slot), ['a1', 'a1', 'a2', 'a2']);
      assert.deepEqual(m.groups.map((g) => g.parentNaverId), [m.campaigns[0].naverId, m.campaigns[0].naverId]);
      const row = await proposalRow(p.id);
      assert.deepEqual([row.status, row.failCode, row.appliedAt instanceof Date], ['applied', null, true]);
      const logs = await client.adOperationLog.findMany({ where: { proposalId: p.id } });
      assert.equal(logs.length, 11, '변이마다 원장 1행(proposalId 포함) — 생성 10 + 공유예산 1');
      assert.ok(logs.every((l) => l.status === 'ok' && l.method === 'POST' && l.ownerId === 'owner'));
      // 재적용은 상태 전이 규칙으로 거부(applied → applying 불가), 네이버 호출 0
      const before = naver.state.calls.length;
      const again = await apply(p.id);
      assert.deepEqual([again.status, again.body.error.code], [409, 'invalid_transition']);
      assert.equal(naver.state.calls.length, before);
    });

    await t.test('ad stored unlocked despite userLock=true is paused immediately and recorded', async () => {
      naver.state.ignoreAdLock = true;
      try {
        const p = await approved();
        const r = await apply(p.id);
        assert.equal(r.body.data.status, 'applied', JSON.stringify(r.body));
        const m = await mirrors(p.id);
        const ids = new Set(m.creatives.map((c) => c.naverId));
        assert.equal(puts(/^\/ncc\/ads\//).filter((c) => ids.has(c.path.split('/').pop()) && c.query.fields === 'userLock' && c.body.userLock === true).length, 4);
        assert.ok(naver.state.ads.filter((x) => ids.has(x.nccAdId)).every((x) => x.userLock === true));
        assert.equal(await client.adOperationLog.count({ where: { proposalId: p.id, method: 'PUT', status: 'ok', step: { startsWith: 'pause:' } } }), 4, '끈 사실을 원장에 남긴다');
      } finally { resetFaults(); }
    });

    await t.test('stored-value drift locks and fails proposal', async () => {
      naver.state.createOverrides.adgroup = { aiAdsOptIn: true };
      try {
        const p = await approved();
        const kw0 = posts(/^\/ncc\/keywords$/);
        const r = await apply(p.id);
        assert.deepEqual([r.status, r.body.data.status, r.body.data.failCode], [200, 'apply_failed', 'drift:aiAdsOptIn']);
        const g = naver.state.adgroups.at(-1);
        assert.equal(g.userLock, true);
        assert.equal(puts(/^\/ncc\/adgroups\//).filter((c) => c.path.endsWith(g.nccAdgroupId) && c.query.fields === 'userLock' && c.body.userLock === true).length, 1, '즉시 끄기');
        assert.equal(posts(/^\/ncc\/keywords$/), kw0, '드리프트 뒤 다음 단계 없음');
        const m = await mirrors(p.id);
        assert.deepEqual(m.groups.map((x) => [x.naverId, x.userLock, x.lockedBy]), [[g.nccAdgroupId, true, 'pending_launch']]);
        const alerts = await client.adAlert.findMany({ where: { type: 'ads.drift' } });
        assert.equal(alerts.length, 1);
        assert.equal(alerts[0].payload.field, 'aiAdsOptIn');
        assert.equal((await proposalRow(p.id)).status, 'apply_failed');
      } finally { resetFaults(); }
    });

    await t.test('extend_group adds only keywords and creatives to the owned group', async () => {
      const base = await approved();
      assert.equal((await apply(base.id)).body.data.status, 'applied');
      const target = (await mirrors(base.id)).groups[0];
      const before = { camp: posts(/^\/ncc\/campaigns$/), grp: posts(/^\/ncc\/adgroups$/) };
      const payload = { groups: [{ name: '무시되는 이름', bidAmt: 1000, keywords: [k('전세 보증보험')], creatives: EXTRA }] };
      const p = await approved({ kind: 'extend_group', payload, targetAdgroupId: target.naverId });
      const r = await apply(p.id);
      assert.deepEqual([r.status, r.body.data.status], [200, 'applied'], JSON.stringify(r.body));
      assert.deepEqual({ camp: posts(/^\/ncc\/campaigns$/), grp: posts(/^\/ncc\/adgroups$/) }, before, '캠페인·그룹은 만들지 않는다');
      const kwCall = POST(/^\/ncc\/keywords$/).at(-1);
      assert.equal(kwCall.query.nccAdgroupId, target.naverId);
      assert.ok(POST(/^\/ncc\/ads$/).slice(-2).every((c) => c.body.nccAdgroupId === target.naverId));
      const m = await mirrors(p.id);
      assert.deepEqual([m.campaigns.length, m.groups.length, m.keywords.length], [0, 0, 1]);
      assert.deepEqual(m.creatives.map((c) => [c.slot, c.parentNaverId, c.lockedBy]), [['a3', target.naverId, 'pending_launch'], ['a4', target.naverId, 'pending_launch']], 'slot = 기존 최대 + 1부터');
      assert.ok(!naver.state.adgroups.some((g) => g.name === '무시되는 이름'));
      // 남의 그룹·미러에 없는 그룹·삭제된 그룹은 네이버 쓰기 0
      const writes0 = naver.state.calls.filter((c) => c.method !== 'GET').length;
      await client.adGroup.create({ data: { ownerId: 'other', adAccountId: a.accountId, naverId: 'grp-foreign-1', name: 'x' } });
      for (const targetAdgroupId of ['grp-not-mirrored', 'grp-foreign-1']) {
        const bad = await approved({ kind: 'extend_group', payload, targetAdgroupId });
        const res = await apply(bad.id);
        assert.deepEqual([res.status, res.body.error?.code], [409, 'target_adgroup_missing'], targetAdgroupId);
        assert.equal((await proposalRow(bad.id)).status, 'approved');
      }
      naver.state.adgroups.find((g) => g.nccAdgroupId === target.naverId).status = 'DELETED';
      const del = await approved({ kind: 'extend_group', payload, targetAdgroupId: target.naverId });
      const res = await apply(del.id);
      assert.deepEqual([res.body.data.status, res.body.data.failCode], ['apply_failed', 'target_adgroup_deleted']);
      assert.equal(naver.state.calls.filter((c) => c.method !== 'GET').length, writes0, '쓰기 0');
      naver.state.adgroups.find((g) => g.nccAdgroupId === target.naverId).status = 'PAUSED';
    });

    await t.test('kill switch blocks apply before any call and stops writes mid-apply', async () => {
      const p = await approved();
      const calls0 = naver.state.calls.length;
      for (const value of [undefined, 'false', 'TRUE', ' true', '1']) {
        if (value === undefined) delete process.env.ADS_EXECUTION_ENABLED; else process.env.ADS_EXECUTION_ENABLED = value;
        const r = await apply(p.id);
        assert.deepEqual([r.status, r.body.error.code], [503, 'ads_paused'], String(value));
      }
      assert.equal(naver.state.calls.length, calls0, '네이버 호출 0');
      assert.equal((await proposalRow(p.id)).status, 'approved');
      process.env.ADS_EXECUTION_ENABLED = 'true';
      // 첫 그룹 생성 응답 직후 스위치가 꺼진다 → 이후 POST 0
      naver.state.hooks.after = (c) => { if (c.method === 'POST' && c.path === '/ncc/adgroups') process.env.ADS_EXECUTION_ENABLED = 'false'; };
      try {
        const n0 = naver.state.calls.filter((c) => c.method === 'POST').length;
        const r = await apply(p.id);
        assert.deepEqual([r.body.data.status, r.body.data.failCode], ['apply_failed', 'ads_paused']);
        const sent = naver.state.calls.filter((c) => c.method === 'POST').slice(n0).map((c) => c.path);
        assert.deepEqual(sent, ['/ncc/campaigns', '/ncc/adgroups']);
      } finally { resetFaults(); process.env.ADS_EXECUTION_ENABLED = 'true'; }
      const r = await apply(p.id); // 스위치를 켜면 이어서 끝낸다(중복 없이)
      assert.equal(r.body.data.status, 'applied');
      assert.equal(naver.state.campaigns.filter((c) => c.name === `mq-${p.id}`).length, 1);
      assert.equal(naver.state.adgroups.filter((g) => g.name === `${p.id}-g1`).length, 1);
    });

    await t.test('account not active at write time stops the write (ads_not_connected)', async () => {
      const p = await approved();
      naver.state.hooks.after = async (c) => { if (c.method === 'POST' && c.path === '/ncc/campaigns') await env.db.exec(`UPDATE ad_accounts SET status='invalid_key'`); };
      try {
        const n0 = posts(/^\/ncc\/adgroups$/);
        const r = await apply(p.id);
        assert.deepEqual([r.body.data.status, r.body.data.failCode], ['apply_failed', 'ads_not_connected']);
        assert.equal(posts(/^\/ncc\/adgroups$/), n0);
      } finally { resetFaults(); await env.db.exec(`UPDATE ad_accounts SET status='active'`); }
    });

    await t.test('apply re-validates bids against the current account cap before claiming', async () => {
      const p = await approved();
      await env.db.exec(`UPDATE ad_accounts SET max_bid_krw = 260`);
      try {
        const calls0 = naver.state.calls.length;
        const r = await apply(p.id);
        assert.deepEqual([r.status, r.body.error.code], [422, 'ads_invariant']);
        assert.equal(naver.state.calls.length, calls0);
        assert.equal((await proposalRow(p.id)).status, 'approved');
      } finally { await env.db.exec(`UPDATE ad_accounts SET max_bid_krw = 2000`); }
      // 하루 상한 1만 원 → 제안 입찰 천장 1000원(승인과 같은 checkProposalBid). maxBid 2000 안이어도 1200은 쓰기 0으로 거부
      const high = await approved({ payload: { groups: PAYLOAD.groups.map((g, i) => ({ ...g, bidAmt: i === 0 ? 1200 : g.bidAmt })) } });
      const calls0 = naver.state.calls.length;
      const r = await apply(high.id);
      assert.deepEqual([r.status, r.body.error?.code, r.body.error?.field], [422, 'ads_invariant', 'groups.0.bidAmt']);
      assert.ok(r.body.error.message.includes('입찰가는 70~1,000원'), `B1: 적용 재검사 메시지도 범위 숫자: ${r.body.error.message}`);
      assert.equal(naver.state.calls.length, calls0);
      assert.equal((await proposalRow(high.id)).status, 'approved');
    });

    await t.test('IDOR: another owner cannot apply; non-allowlisted gets 404', async () => {
      const p = await approved();
      for (const user of ['other', 'outsider']) {
        env.session.user = user;
        const r = await apply(p.id);
        assert.equal(r.status, 404, user);
      }
      env.session.user = 'owner';
      assert.equal((await proposalRow(p.id)).status, 'approved');
    });
  } finally {
    delete process.env.ADS_EXECUTION_ENABLED;
    await env.close();
  }
});
