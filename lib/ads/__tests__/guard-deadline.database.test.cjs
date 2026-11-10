/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process, Response */
// 감시 시간 예산·발송·분류 외 오류(Task 11 fix round 1, 판정 I-4·I-5). 실DB(PGlite) + 느린 가짜 네이버(주입 시계) + 가짜 메일 전송.
// - I-4: 마감(deps.clock 기준)은 끄기·드리프트·재개 루프 안에서도 지킨다. 못 간 엔티티는 '확인 못 함'(재개 안 함) + ads.guard_blind(deadline).
//   발송은 finally에서 반드시 돌고, 안전 유형(pause_failed·cap_100·guard_blind·drift)을 먼저 보낸다.
// - I-5: 분류 외 계정 예외 → ads.guard_blind {reason:'guard_error', code} 후 다음 계정으로. 자동 끄기 없음.
// 훅은 기록·장애 주입만 한다(시계를 앞으로 돌리는 것 포함) — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupGuardEnv, D } = require('./fixtures/guard-env.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;

test('guard deadline, flush order and unclassified errors', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async (t) => {
  const g = await setupGuardEnv(packageDir, 3);
  const { client } = g.env;
  const [c0, c1, c2] = g.camps;
  const { queueAlert } = require('../alerts.ts');
  const sent = [];
  const mail = async (url, init) => { sent.push(JSON.parse(init.body).subject); return new Response('{"id":"x"}', { status: 200 }); };
  Object.assign(process.env, { RESEND_API_KEY: 're_test_key_000000', ADS_ALERT_FROM: 'alerts@minteq.test', ADS_ALERT_EMAILS: 'owner@minteq.test' });
  try {
    await t.test('I-4: deadline honored inside the pause loop; flush runs; critical alerts first', async () => {
      for (const c of [c0, c1, c2]) await g.launch(c);
      for (let i = 1; i <= 7; i++) // 오래된 비안전 알림 7건이 대기열 앞에 있다
        await queueAlert(g.accountId, 'ads.bizmoney_low', { old: i }, { now: () => new Date(Date.parse('2026-03-01T00:00:00Z') + i * 86400000) });
      g.daySpend(D, { [c0.naverId]: 100000 });
      let clock = 0;
      g.S.hooks.before = (c) => { if (c.method === 'PUT') clock += 100_000; return undefined; }; // 느린 네이버: 끄기 하나에 100초
      const n0 = g.S.calls.length;
      let s;
      try { s = await g.runGuard(new Date(`${D}T05:00:00Z`), { clock: () => clock, budgetMs: 150_000, emailTransport: mail }); } finally { g.resetFaults(); }
      const a = s.accounts[0];
      assert.deepEqual([a.paused, a.unchecked], [2, 1 + 3], JSON.stringify(s)); // 끄기 1 + 드리프트 검사 3 = 확인 못 함
      const puts = g.S.calls.slice(n0).filter((c) => c.method === 'PUT');
      assert.equal(puts.length, 2, '마감 뒤에는 끄기도 더 보내지 않는다');
      assert.equal(g.S.calls.slice(n0).filter((c) => c.path === '/ncc/adgroups' || c.path === '/billing/bizmoney').length, 0, '마감 뒤 드리프트·비즈머니 조회 없음');
      const blind = await g.alerts('ads.guard_blind');
      assert.deepEqual(blind.map((x) => x.payload.reason), ['deadline']);
      const cap = await g.alerts('ads.cap_100');
      assert.equal(cap[0].payload.unchecked, 1);
      assert.equal(s.alerts.sent, 5, 'flush가 돌았다');
      const { formatAlertEmail } = require('../alert-format.ts');
      const title = (type) => formatAlertEmail({ type, kstDate: D, accountLabel: '베스트라', payload: {} }).subject;
      assert.deepEqual(new Set(sent.slice(0, 2)), new Set([title('ads.cap_100'), title('ads.guard_blind')]), '안전 유형 먼저');
      assert.ok(sent.slice(2).every((x) => x === title('ads.bizmoney_low') || x === title('ads.cap_90')));
      // 못 간 c2는 다음 날 재개 대상이 아니다(guard 표시 없음)
      assert.equal((await g.row(c2)).lockedBy, null);
    });

    await t.test('I-4: deadline passing during auto-resume → remaining guard rows are not resumed', async () => {
      const day = '2026-03-11';
      assert.deepEqual([(await g.row(c0)).lockedBy, (await g.row(c1)).lockedBy], ['guard', 'guard']);
      g.daySpend(day, {});
      let clock = 0, stats = 0;
      g.S.hooks.before = (c) => { if (c.path === '/stats' && ++stats === 2) clock += 1_000_000; return undefined; }; // 재개 직전 재측정이 매우 느림
      const r0 = [g.resumePuts(c0.naverId), g.resumePuts(c1.naverId)];
      let s;
      try { s = await g.runGuard(new Date(`${D}T15:00:00Z`), { clock: () => clock, budgetMs: 150_000, emailTransport: mail }); } finally { g.resetFaults(); }
      assert.equal(stats, 2);
      assert.deepEqual([s.accounts[0].resumed, s.accounts[0].unchecked], [0, 2], JSON.stringify(s));
      assert.deepEqual([g.resumePuts(c0.naverId), g.resumePuts(c1.naverId)], r0, '마감 뒤에는 재개하지 않는다');
      s = await g.runGuard(new Date(`${D}T15:30:00Z`), { emailTransport: mail });
      assert.equal(s.accounts[0].resumed, 2, '마감이 없으면 재개 대상이었다');
    });

    await t.test('I-5: unclassified per-account error → guard_blind(guard_error) and the loop continues; no auto-pause', async () => {
      await client.adAlert.deleteMany({});
      await g.launch(c2);
      await client.adAccount.update({ where: { id: g.accountId }, data: { dailyCapKrw: 150000 } }); // 상한값 손상
      const later = await client.adAccount.create({ data: { ownerId: 'owner', naverCustomerId: '7000201', label: 'later', apiKeyEnc: 'v1:broken', secretKeyEnc: 'v1:broken', keyLast4: 'zzzz', createdAt: new Date('2099-01-01T00:00:00Z') } });
      g.daySpend('2026-03-20', { [c2.naverId]: 200000 });
      const n0 = g.S.calls.length;
      const s = await g.runGuard(new Date('2026-03-20T05:00:00Z'), { emailTransport: mail });
      const by = Object.fromEntries(s.accounts.map((x) => [x.accountId, x]));
      assert.deepEqual([by[g.accountId].outcome, by[later.id].outcome], ['error', 'error'], '다음 계정도 처리');
      const blind = await client.adAlert.findMany({ where: { type: 'ads.guard_blind', adAccountId: g.accountId } });
      assert.deepEqual(blind.map((x) => [x.payload.reason, x.payload.code]), [['guard_error', 'AdsInvariantError']]);
      assert.equal(/v1:|apiKey|secret/i.test(JSON.stringify(blind[0].payload)), false);
      assert.equal(g.S.calls.slice(n0).filter((c) => c.method === 'PUT').length, 0, '자동 끄기 없음');
      await client.adAccount.update({ where: { id: g.accountId }, data: { dailyCapKrw: 100000 } });
      await client.adAccount.update({ where: { id: later.id }, data: { status: 'invalid_key' } });
    });
  } finally {
    for (const k of ['RESEND_API_KEY', 'ADS_ALERT_FROM', 'ADS_ALERT_EMAILS']) delete process.env[k];
    await g.close();
  }
});
