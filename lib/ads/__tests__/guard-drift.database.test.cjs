/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 감시 크론 — 설정 드리프트 끄기 + 비즈머니(Task 11). 실DB(PGlite) + 가짜 네이버. 시각은 주입한다.
// - 켜진 캠페인 아래 그룹의 ADVoost(aiAdsOptIn)를 누가 켜면 상한 보장이 깨진 것 → 캠페인을 guard로 끄고 ads.drift 알림(알림만 하지 않는다).
// - 비즈머니 < 3×dailyCapKrw → ads.bizmoney_low. 응답 형식 오류는 알림 없이 기록만(크론은 계속).
// 훅은 기록·장애 주입만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupGuardEnv } = require('./fixtures/guard-env.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;

test('ads guard drift and bizmoney on a real database', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async (t) => {
  const g = await setupGuardEnv(packageDir, 2);
  const [c0, c1] = g.camps;
  try {
    await t.test('drift on a lit campaign pauses it as guard and alerts', async () => {
      await g.launch(c0);
      g.daySpend('2026-06-01', { [c0.naverId]: 1000 });
      const group = g.S.adgroups.find((x) => x.nccCampaignId === c0.naverId);
      group.aiAdsOptIn = true;
      const now = new Date('2026-06-01T03:00:00Z');
      const s = await g.runGuard(now);
      assert.equal(s.accounts[0].outcome, 'ok', JSON.stringify(s));
      assert.equal(g.naverCamp(c0.naverId).userLock, true, '드리프트 = 상한 보장 깨짐 → 끈다');
      const r0 = await g.row(c0);
      assert.deepEqual([r0.lockedBy, r0.userLock, r0.lockedAt?.toISOString()], ['guard', true, now.toISOString()]);
      assert.equal(g.pausePuts(c1.naverId), 0, '꺼져 있는 다른 캠페인은 건드리지 않는다');
      const al = await g.alerts('ads.drift');
      assert.equal(al.length, 1);
      assert.deepEqual(al[0].payload, { at: 'guard', entity: 'adgroup', naverId: group.nccAdgroupId, campaign: c0.naverId, field: 'aiAdsOptIn', paused: true });
      assert.equal(al[0].dedupeKey, group.nccAdgroupId, '엔티티별 중복 제거');
      assert.equal((await g.alerts('ads.cap_100')).length, 0, '상한 때문이 아니다');
      group.aiAdsOptIn = false;
    });

    await t.test('bizmoney below 3x cap alerts; malformed response never crashes', async () => {
      const n0 = g.S.calls.length;
      g.daySpend('2026-06-02', {});
      g.S.bizmoney = { bizmoney: 300000, budgetLock: false };
      await g.runGuard(new Date('2026-06-02T03:00:00Z'));
      assert.equal((await g.alerts('ads.bizmoney_low')).length, 0, '정확히 3일치는 부족이 아니다');
      g.daySpend('2026-06-03', {});
      g.S.bizmoney = { bizmoney: 299999, budgetLock: false };
      await g.runGuard(new Date('2026-06-03T03:00:00Z'));
      let al = await g.alerts('ads.bizmoney_low');
      assert.deepEqual(al.map((x) => [x.kstDate, x.payload.bizmoneyKrw, x.payload.thresholdKrw]), [['2026-06-03', 299999, 300000]]);
      for (const [i, body] of [{ bizmoney: 'lots' }, { balance: 1 }, null, { bizmoney: -1 }].entries()) {
        const day = `2026-06-0${4 + i}`;
        g.daySpend(day, {});
        g.S.bizmoney = body;
        const s = await g.runGuard(new Date(`${day}T03:00:00Z`));
        assert.equal(s.accounts[0].outcome, 'ok', `형식 오류는 크론을 멈추지 않는다: ${JSON.stringify(body)}`);
      }
      al = await g.alerts('ads.bizmoney_low');
      assert.equal(al.length, 1, '형식 오류는 알림하지 않는다(모르는 값으로 판단하지 않음)');
      assert.equal(g.S.calls.slice(n0).filter((c) => c.path === '/billing/bizmoney' && c.method === 'GET').length, 6, '실행마다 1회');
    });
  } finally {
    await g.close();
  }
});
