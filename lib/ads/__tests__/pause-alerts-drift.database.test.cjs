/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 안전 끄기 실패는 숨지 않는다(Task 9 판정 round 2) — 드리프트 끄기 실패(잠긴 채 읽힌 엔티티). 실DB(PGlite) + 가짜 네이버.
// 끄기가 실패하면 결과와 무관하게 미러 userLock=false(켜짐·모름) + 알림 ads.pause_failed. 같은 날 ads.drift가 먼저 있어도 묻히지 않는다.
// 훅은 기록·장애 주입만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withPauseAlertEnv, pauseAlerts, failPut } = require('./fixtures/pause-alerts-env.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;
const skip = !packageDir && 'Set PGLITE_SOCKET_PACKAGE';

test('drift pause fails on an entity that reads locked → mirror records userLock=false (unknown) + ads.pause_failed', { skip }, () => withPauseAlertEnv(packageDir, async (a) => {
  const S = a.naver.state;
  const p = await a.approved();
  S.createOverrides.adgroup = { aiAdsOptIn: true }; // userLock=true로 저장됐지만 드리프트
  S.hooks.before = failPut(/^\/ncc\/adgroups\//, 503);
  let r;
  try { r = await a.apply(p.id); } finally { a.resetFaults(); }
  assert.equal(r.body.data.failCode, 'pause_failed:adgroup:g1');
  assert.deepEqual((await a.mirrors(p.id)).groups.map((g) => g.userLock), [false], '끄기 실패 = 꺼졌다고 기록하지 않는다');
  const al = await pauseAlerts(a.env.client);
  assert.deepEqual([al.length, al[0]?.payload.field], [1, 'aiAdsOptIn']);
}));
