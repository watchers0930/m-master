/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 감시 잠금 표시 규칙(Task 11 fix round 1, 판정 I-1·I-2). 실DB(PGlite) + 가짜 네이버. 시각은 주입한다.
// - I-1: lockedBy='guard'는 감시가 새로 읽어 켜짐을 본 것을 스스로 끄고 확인한 경우에만 붙인다(원장 step에 끄기 전 상태 pre_on|pre_unknown).
//   목록 조회 실패·불완전 → ads.guard_blind(campaign_list_incomplete) + 못 본 미러는 단건 재조회: 켜짐이면 끄고 guard, 꺼짐이면 그대로,
//   못 읽으면 끄되 표시하지 않음 → 다음 날 자동 재개는 guard 표시된 것만.
// - I-2: 대장 끄기는 언제나 lockedBy='owner'(guard 덮어씀) → 다음 날 자동 재개 대상이 아니다.
// 훅은 기록·장애 주입만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupGuardEnv, D, D1, T } = require('./fixtures/guard-env.cjs');
const { json } = require('./fixtures/fake-naver.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;

test('guard lock tagging on a real database', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async (t) => {
  const g = await setupGuardEnv(packageDir, 3);
  const { client } = g.env;
  const [c0, c1, c2] = g.camps;
  try {
    await t.test('I-1: incomplete listing at cap → blind; only observed-ON + confirmed-paused entities are tagged guard', async () => {
      for (const c of [c0, c1, c2]) await g.launch(c);
      g.naverCamp(c1.naverId).userLock = true; // 대장이 네이버 화면에서 직접 끔(미러는 lockedBy null 그대로)
      g.daySpend(D, { [c0.naverId]: 100000 });
      let lists = 0, c2Reads = 0;
      g.S.hooks.before = (c) => {
        if (c.method === 'GET' && c.path === '/ncc/campaigns' && ++lists > 2) return json(503, {}); // 비용 측정 뒤 목록 조회 실패
        if (c.method === 'GET' && c.path === `/ncc/campaigns/${c2.naverId}` && ++c2Reads <= 3) return json(500, {}); // c2 단건 첫 조회(재시도 3회 모두) 실패
        return undefined;
      };
      let s;
      try { s = await g.runGuard(T.LOCK); } finally { g.resetFaults(); }
      assert.equal(s.accounts[0].todayCostKrw, 100000, JSON.stringify(s));
      const blind = await g.alerts('ads.guard_blind');
      assert.deepEqual(blind.map((x) => [x.kstDate, x.payload.reason]), [[D, 'campaign_list_incomplete']]);
      assert.equal(g.pausePuts(c1.naverId), 0, '단건 재조회로 꺼짐 확인 → 끄지 않는다');
      assert.equal((await g.row(c1)).lockedBy, null, '꺼져 있던 것에 guard를 붙이지 않는다');
      assert.equal(g.naverCamp(c0.naverId).userLock, true);
      assert.equal((await g.row(c0)).lockedBy, 'guard', '켜짐을 보고 끄고 확인 → guard');
      assert.equal(g.naverCamp(c2.naverId).userLock, true, '상태를 못 읽어도 끄기는 보낸다');
      assert.equal((await g.row(c2)).lockedBy, null, '끄기 전 상태를 모르면 guard 표시 없음');
      const steps = (await client.adOperationLog.findMany({ where: { step: { startsWith: 'guard.' } } })).map((o) => [o.naverId, o.step]);
      assert.deepEqual(steps.filter(([id]) => id === c0.naverId).map(([, st]) => st), ['guard.cap_100.pre_on']);
      assert.deepEqual(steps.filter(([id]) => id === c2.naverId).map(([, st]) => st), ['guard.cap_100.pre_unknown']);

      g.daySpend(D1, {});
      const s2 = await g.runGuard(T.NEXT);
      assert.equal(s2.accounts[0].resumed, 1, JSON.stringify(s2));
      assert.deepEqual([g.resumePuts(c0.naverId), g.resumePuts(c1.naverId), g.resumePuts(c2.naverId)], [1, 0, 0], 'guard 표시된 것만 재개');
      assert.equal(g.naverCamp(c1.naverId).userLock, true);
    });

    await t.test('I-2: owner pause of a guard-locked campaign sets owner; next day it is not resumed', async () => {
      const E = '2026-04-10';
      g.daySpend(E, { [c0.naverId]: 100000 });
      await g.runGuard(new Date(`${E}T05:00:00Z`));
      const r = await g.row(c0);
      assert.equal(r.lockedBy, 'guard');
      const res = await g.lock('campaign', c0.id, { locked: true, expected_lock_version: r.lockVersion });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const r2 = await g.row(c0);
      assert.deepEqual([r2.lockedBy, r2.lockVersion > r.lockVersion], ['owner', true], '대장 끄기는 guard를 owner로 덮는다');
      g.daySpend('2026-04-11', {});
      const before = g.resumePuts(c0.naverId);
      const s = await g.runGuard(new Date(`${E}T15:00:00Z`));
      assert.equal(s.accounts[0].resumed, 0);
      assert.equal(g.resumePuts(c0.naverId), before, '대장이 끈 것은 자동 재개하지 않는다');
      assert.equal(g.naverCamp(c0.naverId).userLock, true);
    });
  } finally {
    await g.close();
  }
});
