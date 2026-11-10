/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 감시 1단계는 'disconnecting' 계정도 본다(최종 판정 A2): 해제 실행이 죽어 켜진 캠페인이 무감시로 남지 않게.
// - 비용 측정 + 상한 끄기는 끄기 전용 클라이언트로(조회·끄기만). 2단계(드리프트·재개·비즈머니)는 하지 않는다.
// - updatedAt에서 10분 넘게 disconnecting이면 ads.guard_blind(reason disconnect_stuck). 젊은 해제는 알리지 않는다.
// 실DB(PGlite) + 가짜 네이버. 훅은 기록·장애 주입만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupGuardEnv, D, D1, T } = require('./fixtures/guard-env.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;

test('guard watches disconnecting accounts in phase 1 only', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async (t) => {
  const g = await setupGuardEnv(packageDir, 2);
  const { client } = g.env;
  const [c0, c1] = g.camps;
  const disconnecting = (updatedAt) => client.adAccount.update({ where: { id: g.accountId }, data: { status: 'disconnecting', disconnectFromStatus: 'active', updatedAt } });
  const blinds = async (reason) => (await g.alerts('ads.guard_blind')).filter((a) => a.payload?.reason === reason);
  const since = (n) => g.S.calls.slice(n);
  try {
    await g.launch(c0);
    await g.launch(c1);

    await t.test('young disconnecting account at cap: spend is measured, lit campaigns are paused, no stuck alert, no phase 2', async () => {
      await disconnecting(new Date(T.LOCK.getTime() - 5 * 60_000));
      g.daySpend(D, { [c0.naverId]: 100000 });
      const n = g.S.calls.length;
      const s = await g.runGuard(T.LOCK);
      const r = s.accounts.find((a) => a.accountId === g.accountId);
      assert.deepEqual([r.outcome, r.todayCostKrw, r.paused], ['ok', 100000, 2], JSON.stringify(s));
      assert.equal(g.naverCamp(c0.naverId).userLock, true);
      assert.equal(g.naverCamp(c1.naverId).userLock, true);
      assert.equal((await g.alerts('ads.cap_100')).length, 1);
      assert.equal((await blinds('disconnect_stuck')).length, 0, '10분 안의 해제는 진행 중이다');
      const calls = since(n);
      assert.equal(calls.filter((c) => c.path === '/billing/bizmoney' || c.path === '/ncc/adgroups' || c.path.startsWith('/ncc/shared-budgets')).length, 0, '2단계 없음');
      assert.equal(calls.filter((c) => c.method !== 'GET' && !(c.method === 'PUT' && c.body?.userLock === true)).length, 0, '끄기 외 변이 없음');
      const acc = await client.adAccount.findUniqueOrThrow({ where: { id: g.accountId } });
      assert.deepEqual([acc.status, acc.lastSpendKrw], ['disconnecting', 100000], '상태는 해제 흐름 소관, 스냅샷은 남긴다');
    });

    await t.test('disconnecting for more than 10 minutes raises guard_blind disconnect_stuck once a day; under cap nothing is resumed', async () => {
      await client.adCampaign.updateMany({ where: { adAccountId: g.accountId }, data: { lockedBy: 'guard', lockedAt: T.LOCK } });
      await disconnecting(new Date(T.NEXT.getTime() - 11 * 60_000));
      g.daySpend(D1, { [c0.naverId]: 10 });
      const n = g.S.calls.length;
      await g.runGuard(T.NEXT);
      const stuck = await blinds('disconnect_stuck');
      assert.deepEqual(stuck.map((a) => a.kstDate), [D1]);
      assert.equal(g.resumePuts(c0.naverId) + g.resumePuts(c1.naverId), 0, '해제 중 계정은 자동 재개하지 않는다');
      assert.ok(since(n).some((c) => c.path === '/stats'), '비용은 계속 잰다');
      await disconnecting(new Date(T.NEXT2.getTime() - 20 * 60_000));
      await g.runGuard(T.NEXT2);
      assert.equal((await blinds('disconnect_stuck')).length, 1, '같은 날 1회');
    });
  } finally {
    await g.close();
  }
});
