/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 안전 끄기의 남은 빈틈(Task 9 CARRY → Task 11): 실DB(PGlite) + 가짜 네이버.
// - R4c: 대장 끄기 200인데 재조회 켜짐 → 502 pause_unconfirmed + 알림 ads.pause_failed(owner_pause_unconfirmed).
// - 네이버 오류가 아닌 실패(복호화·예상 못 한 오류)도 safetyPause는 조용히 지나가지 않는다: 미러 userLock=false + ads.pause_failed, false 반환.
// 두 경우는 서로 다른 계정이라 알림 중복 제거에 묻히지 않는다. 같은 날 ads.drift를 먼저 심는다. 훅은 기록·장애 주입만 한다.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withPauseAlertEnv, pauseAlerts } = require('./fixtures/pause-alerts-env.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;

test('owner pause unconfirmed alerts; safetyPause non-Naver errors record truth + alert', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, () => withPauseAlertEnv(packageDir, async (a) => {
  const S = a.naver.state, { client } = a.env;
  const { setLock } = require('../locks.ts');
  const { safetyPause } = require('../lock-pause.ts');
  const { queueAlert } = require('../alerts.ts');
  const p = await a.approved();
  assert.equal((await a.apply(p.id)).body.data.status, 'applied');
  const ad = (await a.mirrors(p.id)).creatives[0];
  S.ads.find((x) => x.nccAdId === ad.naverId).userLock = false;
  S.ignorePause.add(ad.naverId);
  try {
    await assert.rejects(setLock('owner', { type: 'ad', id: ad.id }, true, 0), (e) => e.code === 'pause_unconfirmed');
  } finally { a.resetFaults(); }
  let al = await pauseAlerts(client);
  assert.deepEqual(al.map((x) => [x.adAccountId, x.payload.reason, x.payload.paused, x.payload.naverId]), [[a.accountId, 'owner_pause_unconfirmed', false, ad.naverId]]);

  // 복호화할 수 없는 키(저장 장애) — 네이버 오류가 아니다
  const bad = await client.adAccount.create({ data: { ownerId: 'owner', naverCustomerId: '7000009', label: 'bad', apiKeyEnc: 'v1:broken', secretKeyEnc: 'v1:broken', keyLast4: 'zzzz' } });
  await queueAlert(bad.id, 'ads.drift', { seeded: 'same-day drift' });
  const m = await client.adCampaign.create({ data: { ownerId: 'owner', adAccountId: bad.id, naverId: 'cmp-bad-0001', name: 'x', userLock: true, lockedBy: 'guard' } });
  const n0 = S.calls.length;
  const ok = await safetyPause(bad, 'campaign', { id: m.id, naverId: m.naverId }, 'guard.cap_100', {}, { reason: 'cap_100' });
  assert.equal(ok, false, '던지지 않고 실패를 돌려준다');
  assert.equal(S.calls.length, n0, '보내지 못했다');
  assert.equal((await client.adCampaign.findUniqueOrThrow({ where: { id: m.id } })).userLock, false, '미러는 사실대로(켜짐·모름)');
  al = (await pauseAlerts(client)).filter((x) => x.adAccountId === bad.id);
  assert.deepEqual(al.map((x) => [x.payload.reason, x.payload.paused, x.payload.naverId]), [['cap_100', false, 'cmp-bad-0001']]);
  // 미러 행이 없는 캠페인(id null)도 같은 경로로 실패를 알린다(행 갱신 없음)
  const ok2 = await safetyPause(bad, 'campaign', { id: null, naverId: 'cmp-bad-0002' }, 'guard.cap_100', {}, { reason: 'cap_100' });
  assert.equal(ok2, false);
}));
