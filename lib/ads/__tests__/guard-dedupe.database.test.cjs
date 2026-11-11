/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 알림 중복 제거 키(Task 11 fix round 1, 판정 I-3): (계정, 유형, KST 날짜, dedupeKey).
// - pause_failed·drift = 엔티티 naverId, guard_blind = 사유. 같은 날 다른 엔티티·다른 사유는 새 알림, 같은 것은 1회.
// 실DB(PGlite) + 가짜 네이버. 훅은 기록·장애 주입만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupGuardEnv, D } = require('./fixtures/guard-env.cjs');
const { json } = require('./fixtures/fake-naver.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;
const at = (hhmm) => new Date(`2026-03-10T${hhmm}:00Z`);

test('same-day second incident on a different entity/reason is alerted', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async () => {
  const g = await setupGuardEnv(packageDir, 2);
  const [c0, c1] = g.camps;
  try {
    await g.launch(c0);
    await g.launch(c1);
    g.daySpend(D, {});
    const grp0 = g.S.adgroups.find((x) => x.nccCampaignId === c0.naverId);
    grp0.aiAdsOptIn = true;
    g.S.ignorePause.add(c0.naverId);
    await g.runGuard(at('01:00')); // KST 10:00 c0 드리프트 끄기 실패
    g.S.ignorePause.clear();
    await g.runGuard(at('01:30')); // c0 꺼짐(같은 엔티티 두 번째 drift·pause → 새 행 없음)
    grp0.aiAdsOptIn = false;
    const pf1 = await g.alerts('ads.pause_failed');
    assert.deepEqual(pf1.map((x) => x.payload.naverId), [c0.naverId]);
    const drift1 = await g.alerts('ads.drift');
    assert.equal(drift1.length, 1, '같은 엔티티 drift는 하루 1회');

    // KST 14:00: 다른 캠페인 c1이 상한으로 끄기 실패(네이버가 무시) + 드리프트도 발생
    g.daySpend(D, { [c1.naverId]: 10000 });
    g.S.ignorePause.add(c1.naverId);
    g.S.adgroups.find((x) => x.nccCampaignId === c1.naverId).useExpSearch = true;
    try { await g.runGuard(at('05:00')); } finally { g.S.ignorePause.clear(); }
    const pf = await g.alerts('ads.pause_failed');
    assert.deepEqual(pf.map((x) => [x.kstDate, x.payload.naverId]).sort(), [[D, c0.naverId], [D, c1.naverId]].sort(), '다른 캠페인의 두 번째 끄기 실패는 새 알림');
    const drift = await g.alerts('ads.drift');
    assert.equal(drift.length, 2, '다른 엔티티 drift는 새 알림');

    // guard_blind: 같은 사유는 하루 1회, 다른 사유는 새 알림
    g.S.hooks.before = (c) => (c.path === '/stats' ? json(503, {}) : undefined);
    try {
      await g.runGuard(at('06:00'));
      await g.runGuard(at('09:00'));
    } finally { g.resetFaults(); }
    // 다른 사유: 상한 상태에서 목록 조회 실패(비용 측정 뒤) → campaign_list_incomplete
    g.daySpend(D, { [c1.naverId]: 10000 });
    let lists = 0;
    g.S.hooks.before = (c) => (c.method === 'GET' && c.path === '/ncc/campaigns' && ++lists > 2 ? json(503, {}) : undefined);
    try { await g.runGuard(at('09:30')); } finally { g.resetFaults(); }
    const { queueAlert } = require('../alerts.ts');
    const blind = await g.alerts('ads.guard_blind');
    assert.deepEqual(blind.map((x) => x.payload.reason).sort(), ['campaign_list_incomplete', 'spend_unknown']);
    // 기본 키('')는 예전처럼 (계정, 유형, 날짜)당 1회
    await queueAlert(g.accountId, 'ads.bizmoney_low', { n: 1 }, { now: () => at('10:00') });
    await queueAlert(g.accountId, 'ads.bizmoney_low', { n: 2 }, { now: () => at('10:30') });
    assert.deepEqual((await g.alerts('ads.bizmoney_low')).map((x) => x.payload.n), [1]);
  } finally {
    await g.close();
  }
});
