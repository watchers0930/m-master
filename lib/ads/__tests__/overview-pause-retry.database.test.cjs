/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process, setTimeout */
// 개요 pauseUnconfirmed — 같은 KST 날짜에 대장 끄기가 두 번 실패해도 위험 표시가 남는다(재검토 N1) — 실DB(PGlite) + 가짜 네이버.
// - 두 번째 실패의 경보는 queueAlert 중복 제거로 첫 행(createdAt = 첫 실패)만 남고, recordIntent는 lockedAt을 두 번째 시각으로 올린다.
//   그래서 'failedAt >= lockedAt'만으로는 녹색 '켜짐'으로 돌아갔다. 규칙: !userLock && (lockedBy !== null || failedAt >= lockedAt).
// - 대장 켜기는 lockedBy를 null로 비우므로(locks.ts claimResume) 정상 켜짐으로 돌아온다.
// 가짜 훅은 장애 주입만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupApplyEnv } = require('./fixtures/apply-env.cjs');
const { json } = require('./fixtures/fake-naver.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;

test('a second failed owner pause on the same KST day keeps pauseUnconfirmed; an owner resume clears it', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async () => {
  const a = await setupApplyEnv(packageDir);
  const { naver, approved, apply, lock, mirrors, resetFaults } = a;
  const { client } = a.env;
  const { getOverview } = require('../overview.ts');
  try {
    const p = await approved();
    assert.equal((await apply(p.id)).body.data.status, 'applied');
    const cmp = (await mirrors(p.id)).campaigns[0];
    await client.adCampaign.update({ where: { id: cmp.id }, data: { userLock: false, lockedBy: null } }); // 켜진 캠페인
    const row = () => client.adCampaign.findUniqueOrThrow({ where: { id: cmp.id } });
    const flag = async () => (await getOverview('owner', cmp.adAccountId, new Date())).campaigns.find((c) => c.id === cmp.id);
    const pause = async () => lock('campaign', cmp.id, { locked: true, expected_lock_version: (await row()).lockVersion });

    naver.state.hooks.before = (c) => (c.method === 'PUT' ? json(503, {}) : undefined);
    try {
      assert.equal((await pause()).status, 502);
      assert.equal((await flag()).pauseUnconfirmed, true, '첫 실패');
      await new Promise((res) => setTimeout(res, 20)); // 두 번째 의도 기록의 lockedAt이 첫 경보 createdAt보다 확실히 늦게
      assert.equal((await pause()).status, 502);
    } finally { resetFaults(); }

    const second = await flag();
    const alerts = await client.adAlert.findMany({ where: { adAccountId: cmp.adAccountId, type: 'ads.pause_failed' } });
    assert.equal(alerts.length, 1, '같은 날 같은 엔티티 경보는 하나로 합쳐진다(전제)');
    assert.ok(alerts[0].createdAt < (await row()).lockedAt, '경보 시각이 마지막 잠금 변경보다 이르다(전제)');
    assert.deepEqual([second.userLock, second.lockedBy, second.pauseUnconfirmed], [false, 'owner', true], '두 번째 실패도 위험 표시');

    // 대장 켜기(claimResume)와 같은 효과: lockedBy=null, lockedAt=now → 정상 켜짐
    await client.adCampaign.update({ where: { id: cmp.id }, data: { lockedBy: null, lockedAt: new Date(), lockVersion: { increment: 1 } } });
    assert.equal((await flag()).pauseUnconfirmed, false, '대장 켜기 뒤에는 정상');
  } finally {
    await a.env.close();
  }
});
