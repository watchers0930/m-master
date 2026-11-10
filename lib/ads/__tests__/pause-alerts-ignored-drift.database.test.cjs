/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 끄기 PUT은 200인데 다시 읽으면 여전히 켜짐(Task 9 fix round 3 I-1) — 드리프트 끄기(inspect → stopIfUnsafe). 실DB(PGlite) + 가짜 네이버(ignorePause).
// 끄기 확인 = 재조회 userLock===true. 아니면 모든 경로에서 끄기 실패: 미러 userLock=false + ads.pause_failed(같은 날 ads.drift가 먼저 있어도).
// 훅은 기록·장애 주입만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withPauseAlertEnv, pauseAlerts } = require('./fixtures/pause-alerts-env.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;
const skip = !packageDir && 'Set PGLITE_SOCKET_PACKAGE';

test('drift pause 200 but still ON on re-read → pause_failed (not drift:userLock) + ads.pause_failed', { skip }, () => withPauseAlertEnv(packageDir, async (a) => {
  const S = a.naver.state;
  const p = await a.approved();
  S.createOverrides.adgroup = { aiAdsOptIn: true, userLock: false };
  S.ignorePauseKinds.add('adgroups');
  let r;
  try { r = await a.apply(p.id); } finally { a.resetFaults(); }
  assert.equal(r.body.data.failCode, 'pause_failed:adgroup:g1');
  assert.deepEqual((await a.mirrors(p.id)).groups.map((g) => g.userLock), [false]);
  const al = await pauseAlerts(a.env.client);
  assert.deepEqual([al.length, al[0]?.payload.field], [1, 'aiAdsOptIn']);
}));
