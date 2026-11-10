/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 적용 중 끄기 실패·extend_group 안전(Task 9 fix round 1) — 실DB(PGlite) + 가짜 네이버.
// - 생성 직후·드리프트 끄기가 실패하면: 미러(pending_launch, 관찰한 userLock=false) + 원장 증거 + pause_failed:<step> + 알림, 다음 적용이 그 끄기를 먼저 재시도.
// - extend_group: 대상 그룹·캠페인이 네이버에서 꺼져 있어야 한다(아니면 409 target_active), 재개 시 slot은 첫 시도에 정한 값을 다시 쓴다.
// 훅은 기록·장애 주입만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupApplyEnv, EXTRA, k } = require('./fixtures/apply-env.cjs');
const { json } = require('./fixtures/fake-naver.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;

test('ads apply pause failure and extend_group safety on a real database', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async (t) => {
  const a = await setupApplyEnv(packageDir);
  const { env, naver, approved, apply, posts, mirrors, proposalRow, resetFaults } = a;
  const { client } = env;
  const S = naver.state;
  const pauseFailedAlert = async () => (await client.adAlert.findMany({ where: { type: 'ads.pause_failed' } })).find((x) => x.payload.reason === 'pause_failed');
  const writes = () => S.calls.filter((c) => c.method !== 'GET').length;
  try {
    await t.test('post-create pause fails (ad ignores userLock, PUT 500) → mirror + pause_failed + alert; next apply retries that pause first', async () => {
      const p = await approved();
      S.ignoreAdLock = true;
      S.hooks.before = (c) => (c.method === 'PUT' && /^\/ncc\/ads\//.test(c.path) && c.body?.userLock === true ? json(500, {}) : undefined);
      let r;
      try { r = await apply(p.id); } finally { resetFaults(); }
      assert.deepEqual([r.body.data.status, r.body.data.failCode], ['apply_failed', 'pause_failed:ad:g1:c0']);
      const m = await mirrors(p.id);
      assert.equal(m.creatives.length, 1, '켜진 소재도 미러에 남아 대장·가드가 볼 수 있다');
      assert.deepEqual([m.creatives[0].userLock, m.creatives[0].lockedBy], [false, 'pending_launch']);
      const evidence = await client.adOperationLog.findMany({ where: { proposalId: p.id, method: 'PUT' } });
      assert.equal(evidence.length, 1);
      assert.notEqual(evidence[0].status, 'ok', '원장에 끄기 실패 증거');
      const alert = await pauseFailedAlert();
      assert.ok(alert, 'ads.drift(reason=pause_failed)');
      assert.deepEqual([alert.payload.step, alert.payload.naverId], ['ad:g1:c0', m.creatives[0].naverId]);
      const live = m.creatives[0].naverId;
      // 2회차: 캠페인 재조회가 실패해도 그보다 먼저 남은 끄기를 재시도했어야 한다
      S.hooks.before = (c) => (c.method === 'GET' && /^\/ncc\/campaigns\/[^/]+$/.test(c.path) ? json(503, {}) : undefined);
      try { r = await apply(p.id); } finally { resetFaults(); }
      assert.deepEqual([r.body.data.status, r.body.data.failCode], ['apply_failed', 'ads_unavailable']);
      assert.equal(S.ads.find((x) => x.nccAdId === live).userLock, true, '다른 무엇보다 먼저 끈다');
      assert.equal((await client.adCreative.findFirstOrThrow({ where: { naverId: live } })).userLock, true);
      S.ads.find((x) => x.nccAdId === live).userLock = false; // 3회차에서도 첫 쓰기가 그 끄기인지 본다
      await client.adCreative.updateMany({ where: { naverId: live }, data: { userLock: false } });
      const c0 = S.calls.length;
      r = await apply(p.id);
      assert.equal(r.body.data.status, 'applied', JSON.stringify(r.body));
      const firstWrite = S.calls.slice(c0).find((c) => c.method !== 'GET');
      assert.deepEqual([firstWrite.method, firstWrite.path, firstWrite.body], ['PUT', `/ncc/ads/${live}`, { nccAdId: live, userLock: true }], '다른 무엇보다 먼저 끄기 재시도');
      assert.equal(S.ads.find((x) => x.nccAdId === live).userLock, true);
      assert.equal((await mirrors(p.id)).creatives.length, 4);
      assert.equal(S.ads.filter((x) => x.nccAdgroupId === m.creatives[0].parentNaverId).length, 2, '소재 중복 없음');
    });

    await t.test('drift pause fails (group aiAdsOptIn + lock ignored, PUT 503) → pause_failed, mirror kept, alert', async () => {
      const p = await approved();
      S.createOverrides.adgroup = { aiAdsOptIn: true, userLock: false };
      S.hooks.before = (c) => (c.method === 'PUT' && /^\/ncc\/adgroups\//.test(c.path) && c.body?.userLock === true ? json(503, {}) : undefined);
      let r;
      try { r = await apply(p.id); } finally { resetFaults(); }
      assert.deepEqual([r.body.data.status, r.body.data.failCode], ['apply_failed', 'pause_failed:adgroup:g1']);
      const m = await mirrors(p.id);
      assert.deepEqual(m.groups.map((g) => [g.userLock, g.lockedBy]), [[false, 'pending_launch']]);
      assert.ok(await pauseFailedAlert());
      for (const g of S.adgroups) g.userLock = true;
    });

    await t.test('extend_group into a live target group or campaign → 409 target_active, zero writes', async () => {
      const base = await approved();
      assert.equal((await apply(base.id)).body.data.status, 'applied');
      const target = (await mirrors(base.id)).groups[0];
      const group = S.adgroups.find((g) => g.nccAdgroupId === target.naverId);
      const camp = S.campaigns.find((c) => c.nccCampaignId === group.nccCampaignId);
      const payload = { groups: [{ name: 'x', bidAmt: 300, keywords: [k('전세 보증보험')], creatives: EXTRA }] };
      for (const live of [group, camp]) {
        live.userLock = false;
        const p = await approved({ kind: 'extend_group', payload, targetAdgroupId: target.naverId });
        const w0 = writes();
        const r = await apply(p.id);
        assert.deepEqual([r.status, r.body.error?.code], [409, 'target_active'], live === group ? 'group' : 'campaign');
        assert.equal(writes(), w0, '쓰기 0');
        assert.equal((await proposalRow(p.id)).status, 'approved');
        live.userLock = true;
      }
    });

    await t.test('extend_group: pending pause retry runs before the target check — a lit target cannot block it', async () => {
      const base = await approved();
      assert.equal((await apply(base.id)).body.data.status, 'applied');
      const target = (await mirrors(base.id)).groups[0];
      const p = await approved({ kind: 'extend_group', payload: { groups: [{ name: 'x', bidAmt: 300, keywords: [k('전세 점검')], creatives: EXTRA }] }, targetAdgroupId: target.naverId });
      S.ignoreAdLock = true;
      S.hooks.before = (c) => (c.method === 'PUT' && /^\/ncc\/ads\//.test(c.path) && c.body?.userLock === true ? json(500, {}) : undefined);
      let r;
      try { r = await apply(p.id); } finally { resetFaults(); }
      assert.equal(r.body.data.failCode, 'pause_failed:ad:g1:c0');
      const live = (await mirrors(p.id)).creatives[0].naverId;
      S.adgroups.find((g) => g.nccAdgroupId === target.naverId).userLock = false; // 그 사이 대장이 대상 그룹을 켰다
      r = await apply(p.id);
      assert.deepEqual([r.status, r.body.data?.status, r.body.data?.failCode], [200, 'apply_failed', 'target_active'], '409로 막히지 않고 재시도부터');
      assert.equal(S.ads.find((x) => x.nccAdId === live).userLock, true, '켜진 소재를 먼저 껐다');
      S.adgroups.find((g) => g.nccAdgroupId === target.naverId).userLock = true;
    });

    await t.test('target turns live between the pre-claim check and the run → apply_failed target_active, zero writes', async () => {
      const base = await approved();
      assert.equal((await apply(base.id)).body.data.status, 'applied');
      const target = (await mirrors(base.id)).groups[0];
      const p = await approved({ kind: 'extend_group', payload: { groups: [{ name: 'x', bidAmt: 300, keywords: [k('전세 확인')], creatives: EXTRA }] }, targetAdgroupId: target.naverId });
      let n = 0;
      S.hooks.before = (c) => {
        if (c.method === 'GET' && c.path === `/ncc/adgroups/${target.naverId}` && ++n === 2) S.adgroups.find((g) => g.nccAdgroupId === target.naverId).userLock = false;
      };
      const w0 = writes();
      let r;
      try { r = await apply(p.id); } finally { resetFaults(); }
      assert.deepEqual([r.status, r.body.data?.status, r.body.data?.failCode], [200, 'apply_failed', 'target_active']);
      assert.equal(writes(), w0);
      S.adgroups.find((g) => g.nccAdgroupId === target.naverId).userLock = true;
    });

    await t.test('extend_group resume after another extend on the same group reuses its slot — zero duplicate POSTs', async () => {
      const base = await approved();
      assert.equal((await apply(base.id)).body.data.status, 'applied');
      const target = (await mirrors(base.id)).groups[0];
      const A = await approved({ kind: 'extend_group', payload: { groups: [{ name: 'x', bidAmt: 300, keywords: [k('보증보험 가입')], creatives: EXTRA }] }, targetAdgroupId: target.naverId });
      let n = 0;
      S.hooks.before = (c) => (c.method === 'POST' && c.path === '/ncc/ads' && ++n === 2 ? json(400, { code: 9999, title: 'rejected' }) : undefined);
      let r;
      try { r = await apply(A.id); } finally { resetFaults(); }
      assert.deepEqual([r.body.data.status, r.body.data.failCode], ['apply_failed', 'rejected:9999']);
      const B = await approved({ kind: 'extend_group', payload: { groups: [{ name: 'y', bidAmt: 300, keywords: [k('보증금 반환')], creatives: [{ headline: '보증금 반환 점검', description: '계약 만료 전 미리 확인해 보세요' }] }] }, targetAdgroupId: target.naverId });
      assert.equal((await apply(B.id)).body.data.status, 'applied');
      const a0 = posts(/^\/ncc\/ads$/);
      r = await apply(A.id);
      assert.equal(r.body.data.status, 'applied', JSON.stringify(r.body));
      assert.equal(posts(/^\/ncc\/ads$/) - a0, 1, '재개는 거절됐던 두 번째 소재만 보낸다');
      const copies = S.ads.filter((x) => x.nccAdgroupId === target.naverId && x.ad?.headline === EXTRA[0].headline);
      assert.equal(copies.length, 1, '첫 소재 중복 0');
      assert.deepEqual((await mirrors(A.id)).creatives.map((c) => c.slot), ['a3', 'a4'], '첫 시도에 정한 slot 유지');
      assert.deepEqual((await mirrors(B.id)).creatives.map((c) => c.slot), ['a5'], 'A가 예약한 slot을 B가 쓰지 않는다');
    });
  } finally {
    delete process.env.ADS_EXECUTION_ENABLED;
    await env.close();
  }
});
