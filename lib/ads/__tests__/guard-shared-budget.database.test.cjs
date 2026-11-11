/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 감시 — 공유예산 없는 계정(핫픽스 2026-11-11: 연결은 공유예산을 만들지 않고 첫 적용이 캠페인과 함께 만든다).
// - 캠페인도 공유예산도 없으면 정상(알림 없음). 캠페인이 있는데 공유예산이 없으면 ads.drift {reason:'shared_budget_missing'}(하루 1회).
// - 그 캠페인들은 자기 하루 예산이 상한이다: 붙이기 전 대조로 보고, 하루 예산을 올렸으면 드리프트로 끈다. 자동 재개는 하지 않는다.
// 훅은 기록·장애 주입만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupGuardEnv, T } = require('./fixtures/guard-env.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;

test('guard on an account without a shared budget', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async (t) => {
  const g = await setupGuardEnv(packageDir, 0);
  const { client } = g.env;
  const missing = async () => (await g.alerts('ads.drift')).filter((x) => x.payload.reason === 'shared_budget_missing');
  try {
    await t.test('no campaigns and no shared budget is normal: no alert', async () => {
      assert.equal((await g.account()).sharedBudgetId, null);
      g.daySpend('2026-06-01', {});
      const s = await g.runGuard(new Date('2026-06-01T03:00:00Z'));
      assert.equal(s.accounts[0].outcome, 'ok', JSON.stringify(s));
      assert.deepEqual(await g.alerts('ads.drift'), []);
    });

    await t.test('campaign without a shared budget: one shared_budget_missing alert a day, own daily budget still checked', async () => {
      const p = await g.approved();
      assert.equal((await g.apply(p.id)).body.data.status, 'applied');
      const [m] = (await g.mirrors(p.id)).campaigns;
      // 공유예산 단계가 실패한 상태를 만든다: 네이버에서 분리 + 계정 기록 없음
      Object.assign(g.naverCamp(m.naverId), { sharedBudgetId: null, sharedDailyBudget: null });
      await client.adAccount.update({ where: { id: g.accountId }, data: { sharedBudgetId: null } });
      await g.launch(m); // 대장이 켬(자기 하루 예산 1만 원이 상한)
      g.daySpend('2026-06-02', { [m.naverId]: 1000 });
      const now = new Date('2026-06-02T03:00:00Z');
      await g.runGuard(now);
      await g.runGuard(new Date('2026-06-02T03:30:00Z'));
      const al = await missing();
      assert.deepEqual(al.map((x) => [x.kstDate, x.dedupeKey, x.payload]), [['2026-06-02', 'shared_budget_missing', { at: 'guard', reason: 'shared_budget_missing' }]], '하루 1회');
      assert.equal(g.pausePuts(m.naverId), 0, '공유예산이 없다는 것만으로 끄지 않는다(캠페인 하루 예산이 상한)');
      assert.equal((await g.alerts('ads.drift')).length, 1, '캠페인별 드리프트 알림 없음');
      // 다음 날 다시 알린다
      g.daySpend('2026-06-03', { [m.naverId]: 0 });
      await g.runGuard(new Date('2026-06-03T03:00:00Z'));
      assert.deepEqual((await missing()).map((x) => x.kstDate), ['2026-06-02', '2026-06-03']);
      // 자기 하루 예산을 상한 위로 올리면 드리프트 → 끈다
      g.naverCamp(m.naverId).dailyBudget = 50000;
      g.daySpend('2026-06-04', { [m.naverId]: 0 });
      await g.runGuard(new Date('2026-06-04T03:00:00Z'));
      assert.equal(g.naverCamp(m.naverId).userLock, true);
      const drift = (await g.alerts('ads.drift')).filter((x) => x.payload.field === 'dailyBudget');
      assert.deepEqual(drift.map((x) => [x.payload.naverId, x.payload.paused]), [[m.naverId, true]]);
      g.naverCamp(m.naverId).dailyBudget = 10000;
    });

    await t.test('a guard-locked campaign is never auto-resumed while the account has no shared budget', async () => {
      const [m] = await client.adCampaign.findMany({ where: { adAccountId: g.accountId } });
      await client.adCampaign.update({ where: { id: m.id }, data: { lockedBy: 'guard', lockedAt: T.LOCK, userLock: true } });
      g.naverCamp(m.naverId).userLock = true;
      g.daySpend('2026-06-05', { [m.naverId]: 0 });
      await g.runGuard(new Date('2026-06-05T03:00:00Z'));
      assert.equal(g.resumePuts(m.naverId), 0);
      assert.equal(g.naverCamp(m.naverId).userLock, true);
      // 대조군: 공유예산을 다시 붙이면(계정 기록 + 네이버 연결) 같은 조건에서 재개된다 → 위의 '재개 없음'은 공유예산 부재 때문이다
      const budget = { sharedBudgetId: 'sbg-back-1', customerId: 1234567, name: 'mq-cap', ownerType: 'CAMPAIGN', deliveryMethod: 'ACCELERATED', dailyBudget: 10000, status: 'ELIGIBLE', numberInUse: 1 };
      g.S.sharedBudgets.push(budget);
      Object.assign(g.naverCamp(m.naverId), { sharedBudgetId: budget.sharedBudgetId, sharedDailyBudget: 10000 });
      await client.adAccount.update({ where: { id: g.accountId }, data: { sharedBudgetId: budget.sharedBudgetId } });
      g.daySpend('2026-06-06', { [m.naverId]: 0 });
      await g.runGuard(new Date('2026-06-06T03:00:00Z'));
      assert.equal(g.resumePuts(m.naverId), 1);
      assert.equal(g.naverCamp(m.naverId).userLock, false);
    });
  } finally {
    await g.close();
  }
});
