/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 감시 끄기(safetyPause) — 끄기 PUT 뒤 재조회가 실패(5xx)하면 '확인 못 함' = 실패로 본다(Task 9 CARRY R1b).
// 미러 userLock=false(모름은 켜짐 쪽) + ads.pause_failed. 훅은 기록·장애 주입만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupGuardEnv } = require('./fixtures/guard-env.cjs');
const { json } = require('./fixtures/fake-naver.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;

test('guard pause: re-read after the pause PUT fails → unconfirmed → mirror false + ads.pause_failed', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async () => {
  const g = await setupGuardEnv(packageDir, 1);
  const [c0] = g.camps;
  try {
    const { queueAlert, kstDate } = require('../alerts.ts');
    await queueAlert(g.accountId, 'ads.drift', { seeded: 'same-day drift' });
    await g.launch(c0);
    const now = new Date();
    g.daySpend(kstDate(now), { [c0.naverId]: 120000 });
    const path = `/ncc/campaigns/${c0.naverId}`;
    let paused = false;
    g.S.hooks.before = (c) => {
      if (c.method === 'PUT' && c.path === path && c.body?.userLock === true) { paused = true; return undefined; }
      return c.method === 'GET' && c.path === path && paused ? json(503, {}) : undefined;
    };
    let s;
    try { s = await g.runGuard(now); } finally { g.resetFaults(); }
    assert.equal(s.accounts[0].outcome, 'ok', JSON.stringify(s));
    assert.equal(paused, true);
    assert.equal(g.naverCamp(c0.naverId).userLock, true, '실제로는 꺼졌지만');
    assert.equal((await g.row(c0)).userLock, false, '확인하지 못했으므로 미러는 켜짐·모름');
    const al = await g.alerts('ads.pause_failed');
    assert.deepEqual(al.map((x) => [x.payload.reason, x.payload.paused]), [['cap_100', false]]);
  } finally {
    await g.close();
  }
});
