/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 감시 끄기(safetyPause) — 네이버 캠페인 끄기 PUT이 200 + '꺼짐'으로 거짓 응답하지만 실제로는 켜진 채(Task 9 CARRY R2e).
// 판정은 재조회뿐 → 미러 userLock=false(사실) + ads.pause_failed. 같은 날 ads.drift가 먼저 있어도 묻히지 않는다.
// 파일마다 새 환경: 알림 중복 제거가 (계정, 유형, KST 날짜)라서. 훅은 기록·장애 주입만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupGuardEnv } = require('./fixtures/guard-env.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;

test('guard pause: campaign PUT lies (200, paused) while still ON → mirror false + ads.pause_failed', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async () => {
  const g = await setupGuardEnv(packageDir, 1);
  const [c0] = g.camps;
  try {
    const { queueAlert } = require('../alerts.ts');
    await queueAlert(g.accountId, 'ads.drift', { seeded: 'same-day drift' });
    await g.launch(c0);
    const { kstDate } = require('../alerts.ts');
    const now = new Date();
    g.daySpend(kstDate(now), { [c0.naverId]: 10000 });
    g.S.ignorePause.add(c0.naverId);
    const s = await g.runGuard(now);
    assert.equal(s.accounts[0].outcome, 'ok', JSON.stringify(s));
    const lie = g.S.calls.find((c) => c.method === 'PUT' && c.path === `/ncc/campaigns/${c0.naverId}` && c.body?.userLock === true);
    assert.ok(lie, '끄기 PUT은 보냈다');
    assert.equal(g.naverCamp(c0.naverId).userLock, false, '네이버에서는 여전히 켜짐');
    const r0 = await g.row(c0);
    assert.deepEqual([r0.userLock, r0.lockedBy], [false, null], '미러는 사실대로 켜짐 — 끄기를 확인 못 했으므로 guard 표시 없음(판정 Task 11 I-1)');
    const al = await g.alerts('ads.pause_failed');
    assert.deepEqual(al.map((x) => [x.payload.reason, x.payload.paused, x.payload.naverId]), [['cap_100', false, c0.naverId]]);
    const cap = await g.alerts('ads.cap_100');
    assert.deepEqual([cap[0].payload.paused, cap[0].payload.pauseFailed], [0, 1]);
  } finally {
    await g.close();
  }
});
