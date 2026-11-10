/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 끄기 PUT은 200인데 다시 읽으면 여전히 켜짐(Task 9 fix round 3 I-1) — 생성 직후 끄기(inspect). 실DB(PGlite) + 가짜 네이버(ignorePause).
// 끄기 확인 = 재조회 userLock===true. 아니면 모든 경로에서 끄기 실패: 미러 userLock=false + ads.pause_failed(같은 날 ads.drift가 먼저 있어도).
// 훅은 기록·장애 주입만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withPauseAlertEnv, pauseAlerts } = require('./fixtures/pause-alerts-env.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;
const skip = !packageDir && 'Set PGLITE_SOCKET_PACKAGE';

test('post-create pause 200 but still ON on re-read → pause_failed + ads.pause_failed', { skip }, () => withPauseAlertEnv(packageDir, async (a) => {
  const S = a.naver.state;
  const p = await a.approved();
  S.ignoreAdLock = true;
  S.ignorePauseKinds.add('ads');
  let r;
  try { r = await a.apply(p.id); } finally { a.resetFaults(); }
  assert.equal(r.body.data.failCode, 'pause_failed:ad:g1:c0');
  const ad = (await a.mirrors(p.id)).creatives[0];
  assert.equal(ad.userLock, false);
  assert.equal(S.ads.find((x) => x.nccAdId === ad.naverId).userLock, false, '네이버에서는 켜진 채');
  const al = await pauseAlerts(a.env.client);
  assert.deepEqual([al.length, al[0]?.payload.reason, al[0]?.payload.step], [1, 'pause_failed', 'ad:g1:c0']);
}));
