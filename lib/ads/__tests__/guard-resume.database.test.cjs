/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 감시 크론 — 다음 날 자동 재개(Task 11, 사용자 결정: KST 0시 이후 첫 실행, lockedBy=guard만). 실DB(PGlite) + 가짜 네이버.
// - KST 경계: 14:59:59Z(같은 날) vs 15:00:00Z(다음 날) — 비용 날짜(/stats timeRange)와 재개 판정 모두.
// - 재개는 쓰기다: 비상 정지 스위치가 꺼져 있으면 재개하지 않는다. 비용 모름·상한 도달이면 재개하지 않는다.
// - 드리프트(Review Focus 1: 네이버 화면에서 ADVoost·확장검색·공유예산을 바꿈)면 재개하지 않고 알림.
// - 재개 PUT 뒤 계정이 active가 아니면(경합) 즉시 다시 끄고 알림 ads.pause_failed(resume_race).
// 훅은 기록·장애 주입만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupGuardEnv, D, D1, T } = require('./fixtures/guard-env.cjs');
const { json } = require('./fixtures/fake-naver.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;

const at = (day, hhmm = '05:00') => new Date(`${day}T${hhmm}:00Z`); // UTC — 05:00Z = KST 14:00, 15:00Z = 다음 날 KST 00:00
const nextDay = (day) => new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

test('ads guard auto-resume on a real database', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async (t) => {
  const g = await setupGuardEnv(packageDir, 3);
  const { client } = g.env;
  const [c0, c1, c2] = g.camps;
  const statsDay = () => JSON.parse(g.S.calls.filter((c) => c.path === '/stats').at(-1).query.timeRange).since;
  const lockAtCap = async (day) => {
    await g.launch(c0);
    g.daySpend(day, { [c0.naverId]: 10000 });
    await g.runGuard(at(day));
    assert.equal((await g.row(c0)).lockedBy, 'guard');
    g.daySpend(day, { [c0.naverId]: 5000 }); // 이후 실행에서 같은 날 비용은 상한 미만 — 날짜 규칙만 남긴다
  };
  try {
    await client.adCampaign.update({ where: { id: c1.id }, data: { lockedBy: 'owner', lockedAt: new Date('2026-03-01T00:00:00Z') } });
    await client.adCampaign.update({ where: { id: c2.id }, data: { lockedAt: new Date('2026-03-01T00:00:00Z') } });
    const before = { c1: await g.row(c1), c2: await g.row(c2) };

    await t.test('next KST day resumes guard locks only, not owner/pending_launch', async () => {
      await lockAtCap(D);
      const locked = await g.row(c0);
      g.daySpend(D1, {});
      let s = await g.runGuard(T.LAST);
      assert.equal(statsDay(), D, '14:59:59Z는 아직 같은 KST 날짜의 비용');
      assert.equal(s.accounts[0].resumed, 0, '같은 KST 날짜(23:59:59)에는 재개하지 않는다');
      assert.equal(g.resumePuts(c0.naverId), 0);

      process.env.ADS_EXECUTION_ENABLED = 'false';
      try { s = await g.runGuard(T.NEXT); } finally { process.env.ADS_EXECUTION_ENABLED = 'true'; }
      assert.equal(statsDay(), D1, '15:00:00Z는 다음 KST 날짜의 비용');
      assert.equal(g.resumePuts(c0.naverId), 0, '비상 정지 중에는 재개(쓰기)하지 않는다');
      assert.deepEqual([(await g.row(c0)).lockedBy, (await g.row(c0)).lockVersion], ['guard', locked.lockVersion]);

      s = await g.runGuard(T.NEXT2);
      assert.equal(s.accounts[0].resumed, 1, JSON.stringify(s));
      assert.equal(g.naverCamp(c0.naverId).userLock, false, '네이버에서 다시 켜짐');
      const r0 = await g.row(c0);
      assert.deepEqual([r0.lockedBy, r0.userLock, r0.lockVersion], [null, false, locked.lockVersion + 1]);
      const put = g.S.calls.filter((c) => c.method === 'PUT' && c.body?.userLock === false).at(-1);
      assert.deepEqual([put.query.fields, put.body], ['userLock', { nccCampaignId: c0.naverId, userLock: false }]);
      assert.equal((await client.adOperationLog.findMany({ where: { step: 'guard.auto_resume', status: 'ok' } })).length, 1);
      const al = await g.alerts('ads.auto_resume');
      assert.deepEqual(al.map((x) => [x.kstDate, x.payload.resumed]), [[D1, 1]]);
      for (const c of [c1, c2]) assert.equal(g.resumePuts(c.naverId), 0, 'owner·pending_launch는 재개하지 않는다');
      const a1 = await g.row(c1), a2 = await g.row(c2);
      assert.deepEqual([a1.lockedBy, a1.lockVersion, a1.userLock], ['owner', before.c1.lockVersion, true]);
      assert.deepEqual([a2.lockedBy, a2.lockVersion, a2.userLock], ['pending_launch', before.c2.lockVersion, true]);
    });

    await t.test('drift blocks auto-resume and alerts', async () => {
      const E = '2026-04-01';
      await lockAtCap(E);
      const group = g.S.adgroups.find((x) => x.nccCampaignId === c0.naverId);
      const budget = g.S.sharedBudgets[0];
      const camp = g.naverCamp(c0.naverId);
      const cases = [
        ['aiAdsOptIn', () => { group.aiAdsOptIn = true; }, () => { group.aiAdsOptIn = false; }],
        ['useExpSearch', () => { group.useExpSearch = true; }, () => { group.useExpSearch = false; }],
        ['dailyBudget', () => { budget.dailyBudget = 20000; }, () => { budget.dailyBudget = 10000; }],
        ['sharedBudgetId', () => { camp.sharedBudgetId = null; }, () => { camp.sharedBudgetId = budget.sharedBudgetId; }],
      ];
      let day = E;
      for (const [field, breakIt, fixIt] of cases) {
        const check = nextDay(day);
        g.daySpend(check, {});
        breakIt();
        let s;
        try { s = await g.runGuard(at(day, '15:00')); } finally { fixIt(); }
        assert.equal(s.accounts[0].resumed, 0, `${field}: 재개하지 않는다`);
        assert.equal(g.naverCamp(c0.naverId).userLock, true, `${field}: 꺼진 채`);
        assert.equal((await g.row(c0)).lockedBy, 'guard', `${field}: 가드 잠금 유지`);
        const drift = (await g.alerts('ads.drift')).filter((x) => x.kstDate === check);
        assert.equal(drift.length, 1, `${field}: 알림`);
        assert.ok(JSON.stringify(drift[0].payload).includes(field), `${field}: 원인 필드 ${JSON.stringify(drift[0].payload)}`);
        day = check;
      }
      // 비용을 모르면 재개하지 않는다(spend_unknown)
      let check = nextDay(day);
      g.S.hooks.after = (c) => (c.path === '/stats' ? json(200, { rows: [] }) : undefined);
      let s;
      try { s = await g.runGuard(at(day, '15:00')); } finally { g.resetFaults(); }
      assert.equal(s.accounts[0].resumed, 0, '비용 모름 → 재개 없음');
      assert.equal(s.accounts[0].todayCostKrw, null);
      assert.equal(g.naverCamp(c0.naverId).userLock, true);
      day = check;
      // 공유예산을 읽지 못하면(확인 못 함) 끄지는 않지만 재개도 하지 않는다
      check = nextDay(day);
      g.daySpend(check, {});
      g.S.hooks.before = (c) => (c.method === 'GET' && c.path.startsWith('/ncc/shared-budgets/') ? json(503, {}) : undefined);
      try { s = await g.runGuard(at(day, '15:00')); } finally { g.resetFaults(); }
      assert.equal(s.accounts[0].resumed, 0, '공유예산 확인 못 함 → 재개 없음');
      assert.equal(g.naverCamp(c0.naverId).userLock, true);
      day = check;
      // 첫 측정은 됐지만 재개 직전 재측정(두 번째 /stats)이 실패해도 재개하지 않는다
      check = nextDay(day);
      g.daySpend(check, {});
      let statsSeen = 0;
      g.S.hooks.after = (c) => (c.path === '/stats' && ++statsSeen === 2 ? json(200, { rows: [] }) : undefined);
      try { s = await g.runGuard(at(day, '15:00')); } finally { g.resetFaults(); }
      assert.deepEqual([statsSeen, s.accounts[0].todayCostKrw, s.accounts[0].resumed], [2, 0, 0], '재측정 모름 → 재개 없음');
      day = check;
      // 모두 고쳐지면 재개된다
      check = nextDay(day);
      g.daySpend(check, {});
      s = await g.runGuard(at(day, '15:00'));
      assert.equal(s.accounts[0].resumed, 1, JSON.stringify(s));
      assert.equal(g.naverCamp(c0.naverId).userLock, false);
    });

    await t.test('resume race: account leaves active during the resume PUT → re-pause + ads.pause_failed(resume_race)', async () => {
      const F = '2026-05-01';
      await lockAtCap(F);
      g.daySpend(nextDay(F), {});
      g.S.hooks.before = async (c) => {
        if (c.method === 'PUT' && c.path === `/ncc/campaigns/${c0.naverId}` && c.body?.userLock === false)
          await g.env.db.query(`UPDATE ad_accounts SET status='invalid_key' WHERE id=$1`, [g.accountId]);
        return undefined;
      };
      try { await g.runGuard(at(F, '15:00')); } finally { g.resetFaults(); }
      assert.equal(g.naverCamp(c0.naverId).userLock, true, '즉시 다시 껐다');
      const r0 = await g.row(c0);
      assert.deepEqual([r0.lockedBy, r0.userLock], ['guard', true]);
      const al = await g.alerts('ads.pause_failed');
      assert.deepEqual(al.map((x) => [x.payload.reason, x.payload.paused]), [['resume_race', true]]);
      await client.adAccount.update({ where: { id: g.accountId }, data: { status: 'active' } });
    });
  } finally {
    await g.close();
  }
});
