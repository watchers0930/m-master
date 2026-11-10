/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 안전 끄기 실패는 숨지 않는다(Task 9 판정 round 2) — 생성 직후 끄기 실패. 실DB(PGlite) + 가짜 네이버.
// 끄기가 실패하면 결과와 무관하게 미러 userLock=false(켜짐·모름) + 알림 ads.pause_failed. 같은 날 ads.drift가 먼저 있어도 묻히지 않는다.
// 훅은 기록·장애 주입만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withPauseAlertEnv, pauseAlerts, failPut } = require('./fixtures/pause-alerts-env.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;
const skip = !packageDir && 'Set PGLITE_SOCKET_PACKAGE';

test('post-create pause fails → mirror userLock=false + ads.pause_failed despite a same-day ads.drift', { skip }, () => withPauseAlertEnv(packageDir, async (a) => {
  const S = a.naver.state;
  const p = await a.approved();
  S.ignoreAdLock = true;
  S.hooks.before = failPut(/^\/ncc\/ads\//);
  let r;
  try { r = await a.apply(p.id); } finally { a.resetFaults(); }
  assert.equal(r.body.data.failCode, 'pause_failed:ad:g1:c0');
  assert.equal((await a.mirrors(p.id)).creatives[0].userLock, false);
  const al = await pauseAlerts(a.env.client);
  assert.equal(al.length, 1, 'ads.drift가 이미 있어도 끄기 실패 알림이 생긴다');
  assert.deepEqual([al[0].payload.reason, al[0].payload.step], ['pause_failed', 'ad:g1:c0']);
}));
