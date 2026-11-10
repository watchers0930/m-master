/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 감시 크론 — 감시 불가(ads.guard_blind, Task 11 판정 concerns 1·2). 실DB(PGlite) + 가짜 네이버. 시각은 주입한다.
// - active 계정의 오늘 비용을 볼 수 없으면(/stats 형식 오류 = spend_unknown, 키 복호화 실패, 클라이언트 생성 실패) ads.guard_blind(계정·KST 날짜당 1회).
//   자동 끄기는 하지 않는다. 다음 계정으로 계속 간다. 같은 날 ads.drift가 있어도 묻히지 않는다. 다음 KST 날짜(주입 now)면 새 행.
// - 감시 경로의 모든 알림(ads.pause_failed 포함)은 주입된 now의 KST 날짜를 쓴다.
// 훅은 기록·장애 주입만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupGuardEnv } = require('./fixtures/guard-env.cjs');
const { json } = require('./fixtures/fake-naver.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;

test('ads guard blind alerts on a real database', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async (t) => {
  const g = await setupGuardEnv(packageDir, 1);
  const { client } = g.env;
  const [c0] = g.camps;
  const { queueAlert, ALERT_TYPES } = require('../alerts.ts');
  const { formatAlertEmail } = require('../alert-format.ts');
  const blind = (accountId) => client.adAlert.findMany({ where: { type: 'ads.guard_blind', adAccountId: accountId }, orderBy: { kstDate: 'asc' } });
  try {
    await t.test('guard_blind type and copy', () => {
      assert.ok(ALERT_TYPES.includes('ads.guard_blind'));
      const mail = formatAlertEmail({ type: 'ads.guard_blind', kstDate: '2026-07-01', accountLabel: '베스트라', payload: { reason: 'spend_unknown' } });
      for (const phrase of ['감시', '공유예산', '확인']) assert.ok(mail.subject.includes(phrase) || mail.text.includes(phrase), phrase);
    });

    await t.test('stats malformed and decrypt failure → guard_blind, no auto-pause, loop continues, not suppressed by same-day drift', async () => {
      await g.launch(c0);
      // 복호화할 수 없는 계정이 주 계정 앞(early)과 뒤(bad)에 온다(createdAt 순) — 어느 감시 불가 뒤에도 루프가 계속 가는지 본다
      const early = await client.adAccount.create({ data: { ownerId: 'owner', naverCustomerId: '7000100', label: 'early', apiKeyEnc: 'v1:broken', secretKeyEnc: 'v1:broken', keyLast4: 'zzzz', createdAt: new Date('2000-01-01T00:00:00Z') } });
      const bad = await client.adAccount.create({ data: { ownerId: 'owner', naverCustomerId: '7000101', label: 'bad', apiKeyEnc: 'v1:broken', secretKeyEnc: 'v1:broken', keyLast4: 'zzzz', createdAt: new Date('2099-01-01T00:00:00Z') } });
      const day = '2026-07-01', now = new Date('2026-07-01T03:00:00Z');
      await queueAlert(g.accountId, 'ads.drift', { seeded: 'same-day drift' }, { now: () => now });
      g.S.hooks.after = (c) => (c.path === '/stats' ? json(200, { rows: [] }) : undefined);
      let s;
      try { s = await g.runGuard(now); } finally { g.resetFaults(); }
      const by = Object.fromEntries(s.accounts.map((x) => [x.accountId, x]));
      assert.deepEqual([by[g.accountId].outcome, by[g.accountId].todayCostKrw], ['ok', null], JSON.stringify(s));
      assert.equal(by[bad.id].outcome, 'error', '다음 계정도 처리했다');
      assert.equal(by[early.id].outcome, 'error');
      assert.equal(s.accounts.length, 3);
      assert.deepEqual((await blind(early.id)).map((x) => x.payload.reason), ['credential_unavailable']);
      const mine = await blind(g.accountId);
      assert.deepEqual(mine.map((x) => [x.kstDate, x.payload.reason]), [[day, 'spend_unknown']], '같은 날 ads.drift가 있어도 묻히지 않는다');
      const theirs = await blind(bad.id);
      assert.deepEqual(theirs.map((x) => [x.kstDate, x.payload.reason]), [[day, 'credential_unavailable']]);
      for (const a of [...mine, ...theirs]) assert.equal(/v1:|apiKey|secret/i.test(JSON.stringify(a.payload)), false, '비밀값 없음');
      assert.equal(g.pausePuts(c0.naverId), 0, '감시 불가만으로 자동 끄기하지 않는다');
      assert.equal(g.naverCamp(c0.naverId).userLock, false);

      // 같은 날 두 번째 실행은 행을 늘리지 않고, 다음 KST 날짜(주입 now)는 새 행
      g.S.hooks.after = (c) => (c.path === '/stats' ? json(200, { rows: [] }) : undefined);
      try {
        await g.runGuard(new Date('2026-07-01T03:30:00Z'));
        await g.runGuard(new Date('2026-07-01T15:00:00Z')); // KST 07-02 00:00
      } finally { g.resetFaults(); }
      assert.deepEqual((await blind(g.accountId)).map((x) => x.kstDate), [day, '2026-07-02']);
      assert.deepEqual((await blind(bad.id)).map((x) => x.kstDate), [day, '2026-07-02']);
      await client.adAccount.updateMany({ where: { id: { in: [bad.id, early.id] } }, data: { status: 'invalid_key' } });
    });

    await t.test('pause_failed from guard paths uses the injected now', async () => {
      g.daySpend('2026-08-01', { [c0.naverId]: 100000 });
      g.S.ignorePause.add(c0.naverId);
      try { await g.runGuard(new Date('2026-08-01T03:00:00Z')); } finally { g.resetFaults(); }
      const al = await g.alerts('ads.pause_failed');
      assert.deepEqual(al.map((x) => [x.kstDate, x.payload.reason, x.payload.paused]), [['2026-08-01', 'cap_100', false]]);
      assert.equal((await blind(g.accountId)).filter((x) => x.kstDate === '2026-08-01').length, 0, '비용을 봤으면 감시 불가 아님');
    });
  } finally {
    await g.close();
  }
});
