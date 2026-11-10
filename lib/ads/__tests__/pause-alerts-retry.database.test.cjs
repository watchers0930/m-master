/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 안전 끄기 실패는 숨지 않는다(Task 9 판정 round 2) — 남은 끄기 재시도 실패. 실DB(PGlite) + 가짜 네이버.
// 끄기가 실패하면 결과와 무관하게 미러 userLock=false(켜짐·모름) + 알림 ads.pause_failed. 같은 날 ads.drift가 먼저 있어도 묻히지 않는다.
// 훅은 기록·장애 주입만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withPauseAlertEnv, pauseAlerts, failPut } = require('./fixtures/pause-alerts-env.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;
const skip = !packageDir && 'Set PGLITE_SOCKET_PACKAGE';

test('pending-pause retry fails → stays userLock=false + ads.pause_failed', { skip }, () => withPauseAlertEnv(packageDir, async (a) => {
  const S = a.naver.state, { client } = a.env;
  const p = await a.approved();
  assert.equal((await a.apply(p.id)).body.data.status, 'applied');
  const ad = (await a.mirrors(p.id)).creatives[0];
  S.ads.find((x) => x.nccAdId === ad.naverId).userLock = false; // 끄기 실패로 켜진 채 남은 상황
  await client.adCreative.update({ where: { id: ad.id }, data: { userLock: false } });
  await client.adProposal.update({ where: { id: p.id }, data: { status: 'apply_failed', failCode: 'pause_failed:ad:g1:c0' } });
  S.hooks.before = failPut(new RegExp(`^/ncc/ads/${ad.naverId}$`));
  let r;
  try { r = await a.apply(p.id); } finally { a.resetFaults(); }
  assert.equal(r.body.data.failCode, `pause_failed:retry:ad:${ad.naverId}`);
  assert.equal((await client.adCreative.findUniqueOrThrow({ where: { id: ad.id } })).userLock, false);
  const al = await pauseAlerts(client);
  assert.deepEqual([al.length, al[0]?.payload.reason], [1, 'pause_failed']);
}));
