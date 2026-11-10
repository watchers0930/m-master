/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 빈 /stats 응답이 켜기를 교착시키지 않는다(재검토 N2) — 실DB(PGlite) + 가짜 네이버(statsOmitIdle: 활동 없는 행을 빼고 data:[]).
// - 대장 첫 켜기(locks.ts): 모든 캠페인이 어제 이전부터 꺼진 새 계정은 0원으로 보고 켤 수 있다. 오늘 수정된 캠페인이 있으면 409 spend_unknown.
// - 감시(guard.ts): 같은 규칙으로 스냅샷 0원 · guard_blind 없음, 켜진 캠페인이 있으면 null + guard_blind(spend_unknown).
// 가짜 훅은 장애 주입만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupGuardEnv } = require('./fixtures/guard-env.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;

test('an empty /stats reply for an all-off account does not deadlock launch', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async (t) => {
  const g = await setupGuardEnv(packageDir, 1);
  const { client } = g.env;
  const [c0] = g.camps;
  const S = g.S;
  const at = (ms) => new Date(ms).toISOString();
  const editAll = (editTm) => { for (const c of S.campaigns) c.editTm = editTm; };
  const unlock = async () => lock(c0);
  const lock = async (m) => g.lock('campaign', m.id, { locked: false, expected_lock_version: (await g.row(m)).lockVersion });
  S.statsOmitIdle = true;
  try {
    await t.test('owner launch: edited today → spend_unknown, no resume PUT', async () => {
      assert.equal(S.campaigns.every((c) => c.userLock === true), true, '전제: 적용 직후 모두 꺼짐');
      editAll(at(Date.now() - 60_000)); // 오늘(1분 전) 수정
      const r = await unlock();
      assert.deepEqual([r.status, r.body.error?.code], [409, 'spend_unknown']);
      assert.equal(g.resumePuts(c0.naverId), 0);
    });

    await t.test('owner launch: every campaign off since before today → 0원, the first launch is allowed', async () => {
      editAll(at(Date.now() - 36 * 3_600_000)); // KST 날짜와 무관하게 어제 이전
      const r = await unlock();
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.deepEqual([r.body.data.userLock, r.body.data.lockedBy], [false, null]);
      assert.equal(g.resumePuts(c0.naverId), 1);
      assert.equal(S.campaigns.find((c) => c.nccCampaignId === c0.naverId).userLock, false, '네이버에서 켜짐');
    });

    await t.test('guard: a lit campaign keeps the empty reply unknown (null + guard_blind)', async () => {
      const now = new Date();
      await g.runGuard(now);
      const acc = await client.adAccount.findUniqueOrThrow({ where: { id: g.accountId } });
      assert.equal(acc.lastSpendKrw, null, '켜진 캠페인이 있으면 0으로 보지 않는다');
      const blind = (await g.alerts('ads.guard_blind')).filter((x) => x.payload?.reason === 'spend_unknown');
      assert.equal(blind.length, 1);
    });

    await t.test('guard: all off since before today → snapshot 0, no new guard_blind', async () => {
      const day = '2026-06-01';
      for (const c of S.campaigns) c.userLock = true;
      editAll('2026-05-31T14:59:59Z'); // KST 2026-05-31 23:59:59
      await client.adAlert.deleteMany({ where: { type: 'ads.guard_blind' } });
      const now = new Date(`${day}T03:00:00Z`);
      await g.runGuard(now);
      const acc = await client.adAccount.findUniqueOrThrow({ where: { id: g.accountId } });
      assert.deepEqual([acc.lastGuardAt?.toISOString(), acc.lastSpendKrw], [now.toISOString(), 0]);
      assert.equal((await g.alerts('ads.guard_blind')).filter((x) => x.payload?.reason === 'spend_unknown').length, 0);
    });
  } finally {
    S.statsOmitIdle = false;
    await g.close();
  }
});
