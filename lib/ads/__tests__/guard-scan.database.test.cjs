/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 감시 드리프트 검사·자동 재개 범위(최종 판정 A3): 50개에서 조용히 멈추지 않는다.
// - 대상 = 미러 중 네이버 목록에 있고 DELETED가 아닌 캠페인(삭제됐거나 네이버에 없는 미러는 빼고 GET도 하지 않는다).
// - 대상 전체를 마감 안에서 페이지로 넘겨 검사한다. 다 못 보면 ads.guard_blind(scan_truncated, covered, total).
// 실DB(PGlite) + 가짜 네이버. 훅은 시계 이동만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupGuardEnv } = require('./fixtures/guard-env.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;
const LIVE = 55, DELETED = 5, GHOST = 3;
const nid = (kind, i) => `cmp-zz-${kind}-${String(i).padStart(4, '0')}`;

test('guard drift scan covers every eligible campaign or says it did not', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async (t) => {
  const g = await setupGuardEnv(packageDir, 1);
  const { client } = g.env;
  const [c0] = g.camps;
  const template = JSON.parse(JSON.stringify(g.naverCamp(c0.naverId)));
  const mirror = (naverId) => client.adCampaign.create({ data: { ownerId: 'owner', adAccountId: g.accountId, naverId, name: naverId, userLock: true, lockedBy: 'owner' } });
  for (let i = 0; i < LIVE; i++) { g.S.campaigns.push({ ...template, nccCampaignId: nid('l', i), name: nid('l', i), userLock: true, status: 'PAUSED' }); await mirror(nid('l', i)); }
  for (let i = 0; i < DELETED; i++) { g.S.campaigns.push({ ...template, nccCampaignId: nid('d', i), name: nid('d', i), userLock: true, status: 'DELETED' }); await mirror(nid('d', i)); }
  for (let i = 0; i < GHOST; i++) await mirror(nid('g', i)); // 네이버에 없는 미러
  const last = nid('l', LIVE - 1); // naverId 순으로 맨 뒤(예전 50개 상한 밖)
  const gets = (from, id) => g.S.calls.slice(from).filter((c) => c.method === 'GET' && c.path === `/ncc/campaigns/${id}`).length;
  const blinds = async () => (await g.alerts('ads.guard_blind')).filter((a) => a.payload?.reason === 'scan_truncated');
  try {
    await t.test('a lit drifted campaign beyond the 50th mirror is paused; DELETED and ghost mirrors are skipped without a GET', async () => {
      const camp = g.S.campaigns.find((c) => c.nccCampaignId === last);
      Object.assign(camp, { userLock: false, useDailyBudget: false }); // 누가 네이버에서 켜고 하루 예산을 풀었다
      const from = g.S.calls.length;
      const s = await g.runGuard(new Date('2026-07-01T03:00:00Z'));
      assert.equal(s.accounts[0].outcome, 'ok', JSON.stringify(s));
      assert.equal(camp.userLock, true, '51번째 이후 캠페인도 드리프트면 끈다');
      assert.ok((await g.alerts('ads.drift')).some((a) => a.payload.naverId === last));
      for (let i = 0; i < DELETED; i++) assert.equal(gets(from, nid('d', i)), 0, 'DELETED 미러는 검사하지 않는다');
      for (let i = 0; i < GHOST; i++) assert.equal(gets(from, nid('g', i)), 0, '네이버에 없는 미러는 검사하지 않는다');
      assert.equal(gets(from, nid('l', 0)), 1);
      assert.equal((await blinds()).length, 0, '다 봤으면 잘림 알림 없음');
      Object.assign(camp, { useDailyBudget: true });
    });

    await t.test('a guard lock beyond the 50th row resumes the next KST day when clean', async () => {
      await client.adCampaign.updateMany({ where: { naverId: last }, data: { lockedBy: 'guard', lockedAt: new Date('2026-07-01T03:00:00Z') } });
      await g.runGuard(new Date('2026-07-01T15:10:00Z')); // 다음 KST 날
      assert.equal(g.resumePuts(last), 1);
      assert.equal(g.S.campaigns.find((c) => c.nccCampaignId === last).userLock, false);
    });

    await t.test('more than 50 guard locks from yesterday: all clean ones resume in one run (no silent 50 cap)', async () => {
      const ids = Array.from({ length: 52 }, (_, i) => nid('l', i));
      await client.adCampaign.updateMany({ where: { naverId: { in: ids } }, data: { lockedBy: 'guard', lockedAt: new Date('2026-07-01T16:00:00Z') } });
      for (const id of ids) g.S.campaigns.find((c) => c.nccCampaignId === id).userLock = true;
      const s = await g.runGuard(new Date('2026-07-02T15:10:00Z'));
      assert.equal(s.accounts[0].resumed, 52, JSON.stringify(s.accounts[0]));
      assert.equal(await client.adCampaign.count({ where: { naverId: { in: ids }, lockedBy: 'guard' } }), 0);
    });

    await t.test('when the deadline stops the scan early: ads.guard_blind(scan_truncated) with covered < total', async () => {
      let clock = 0;
      g.S.hooks.before = (c) => { if (c.method === 'GET' && /^\/ncc\/campaigns\/cmp-zz/.test(c.path)) clock += 1_000; return undefined; };
      try { await g.runGuard(new Date('2026-07-03T03:00:00Z'), { clock: () => clock, budgetMs: 10_500 }); } finally { g.resetFaults(); }
      const [b] = await blinds();
      assert.ok(b, 'scan_truncated 알림');
      assert.equal(b.payload.total, 1 + LIVE, '대상 = 네이버에 살아 있는 미러(삭제·없는 것 제외)');
      assert.ok(b.payload.covered > 0 && b.payload.covered < b.payload.total, JSON.stringify(b.payload));
    });
  } finally {
    await g.close();
  }
});
