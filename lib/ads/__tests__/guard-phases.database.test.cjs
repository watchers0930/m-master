/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process, Response, AbortController */
// 감시 2단계·호출 마감·발송 보장(Task 11 fix round 2 판정 (a)(b)(d)). 실DB(PGlite) + 느린 가짜 네이버(주입 시계) + 가짜 메일.
// - (a) 1단계(모든 계정: 비용 측정 + 상한 끄기) → 2단계(드리프트·재개·비즈머니). 앞 계정의 느린 드리프트가 뒤 계정의 상한 끄기를 굶기지 않는다(프로브 X).
// - (b) 감시의 모든 네이버 호출은 남은 예산(마감 − 발송 예약 − 지금)으로 마감이 걸린다. 호출마다 44초인 느린 네이버(프로브 F3)에서도
//   발송이 240초 전에 시작하고 실행은 300초 안에 끝난다.
// - (d) 계정 루프 밖에서 예외가 나도 발송은 돈다(그 뒤 예외를 다시 던진다).
// 훅은 기록·장애 주입(시계 전진 포함)만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupGuardEnv, D } = require('./fixtures/guard-env.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;
const CID = '1234567', CID2 = '7654321';

test('two-phase guard, per-call deadline and flush guarantee', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async (t) => {
  const g = await setupGuardEnv(packageDir, 3);
  const { client } = g.env;
  const { encryptSecret } = require('../../crypto/credentials.ts');
  const { adCredentialContext } = require('../../external/naver-searchad.ts');
  const { queueAlert } = require('../alerts.ts');
  const { WORK_WINDOW_MS } = require('../guard.ts');
  const sends = [];
  let t0 = 0, now = 0, lastTimeout = 45_000;
  const naverClock = { now: () => now, sleep: async (ms) => { now += ms; }, timeout: (ms) => { lastTimeout = ms; return new AbortController().signal; } };
  const mail = async (url, init) => { sends.push({ at: now - t0, subject: JSON.parse(init.body).subject }); return new Response('{"id":"x"}', { status: 200 }); };
  Object.assign(process.env, { RESEND_API_KEY: 're_test_key_000000', ADS_ALERT_FROM: 'alerts@minteq.test', ADS_ALERT_EMAILS: 'owner@minteq.test' });
  try {
    for (const c of g.camps) { g.naverCamp(c.naverId)._customer = CID; await g.launch(c); }
    const budget = g.S.sharedBudgets[0];

    await t.test('(a) an earlier under-cap account with slow drift never starves a later account cap pause (probe X)', async () => {
      const KEY2 = '0200000000eeeeeeeeffffffffgggggggghhhh9z8y', SEC2 = 'AQAAAADsecondSECOND000secret==';
      g.S.keys.set(CID2, { apiKey: KEY2, secretKey: SEC2 });
      const a = await client.adAccount.create({ data: {
        ownerId: 'owner', naverCustomerId: CID2, label: 'A', keyLast4: '9z8y', dailyCapKrw: 10000, sharedBudgetKrw: 10000, sharedBudgetId: budget.sharedBudgetId, createdAt: new Date('2000-01-01T00:00:00Z'),
        apiKeyEnc: encryptSecret(KEY2, adCredentialContext('api_key', 'owner', CID2)), secretKeyEnc: encryptSecret(SEC2, adCredentialContext('secret_key', 'owner', CID2)),
      } });
      const ca = { nccCampaignId: 'cmp-acct-a-0001', _customer: CID2, name: 'a', userLock: false, status: 'ELIGIBLE', sharedBudgetId: budget.sharedBudgetId, useDailyBudget: true, dailyBudget: 10000, sharedDailyBudget: 10000 };
      g.S.campaigns.push(ca);
      const proto = g.S.adgroups[0];
      g.S.adgroups.push({ ...proto, nccAdgroupId: 'grp-acct-a-0001', nccCampaignId: ca.nccCampaignId });
      await client.adCampaign.create({ data: { ownerId: 'owner', adAccountId: a.id, naverId: ca.nccCampaignId, name: 'a', userLock: false, lockedBy: null } });
      g.daySpend(D, { [g.camps[0].naverId]: 10000 }); // 뒤 계정(주 계정)만 상한
      g.S.hooks.before = (c) => { if (c.method === 'GET' && c.path === '/ncc/adgroups' && c.query.nccCampaignId === ca.nccCampaignId) now += 150_000; return undefined; };
      t0 = now;
      let s;
      try { s = await g.runGuard(new Date(`${D}T05:00:00Z`), { clock: () => now, naverClock, emailTransport: mail }); } finally { g.resetFaults(); }
      const by = Object.fromEntries(s.accounts.map((x) => [x.accountId, x]));
      assert.equal(by[a.id].todayCostKrw, 0, JSON.stringify(s));
      assert.equal(by[g.accountId].todayCostKrw, 10000);
      const pf = (await g.alerts('ads.pause_failed')).map((x) => x.payload.naverId);
      for (const c of g.camps) assert.ok(g.naverCamp(c.naverId).userLock === true || pf.includes(c.naverId), `${c.naverId}: 꺼졌거나 pause_failed`);
      assert.ok(g.camps.every((c) => g.naverCamp(c.naverId).userLock === true), '세 캠페인 모두 꺼짐');
      await client.adAccount.update({ where: { id: a.id }, data: { status: 'invalid_key' } });
    });

    await t.test('(b) 44s per Naver call: flush starts before 240s and the run ends within 300s (probe F3)', async () => {
      for (const c of g.camps) await g.launch(c);
      g.daySpend('2026-03-12', { [g.camps[0].naverId]: 10000 });
      g.S.hooks.before = () => { now += Math.min(44_000, lastTimeout); return undefined; }; // 느린 네이버: 호출마다 44초(시도 타임아웃보다 길게 걸리지 않음)
      sends.length = 0;
      t0 = now;
      let s;
      try { s = await g.runGuard(new Date('2026-03-12T05:00:00Z'), { clock: () => now, naverClock, emailTransport: mail }); } finally { g.resetFaults(); }
      assert.ok(sends.length > 0, '발송했다');
      assert.ok(sends[0].at < 240_000, `발송 시작 ${sends[0].at}ms < 240초`);
      assert.ok(sends[0].at <= WORK_WINDOW_MS, `네이버 작업은 창(${WORK_WINDOW_MS}ms) 안에서 끝난다: ${sends[0].at}`);
      assert.ok(now - t0 < 300_000, `실행 ${now - t0}ms < 300초`);
      const main = s.accounts.find((x) => x.accountId === g.accountId);
      assert.ok(main.paused >= 1, JSON.stringify(s));
    });

    await t.test('(b2) every GET slow and failing (503 after waiting): retries stay inside the budget, flush still before 240s', async () => {
      g.daySpend('2026-03-14', {});
      g.S.hooks.before = (c) => { now += Math.min(44_000, lastTimeout); return c.method === 'GET' ? require('./fixtures/fake-naver.cjs').json(503, {}) : undefined; };
      sends.length = 0;
      t0 = now;
      try { await g.runGuard(new Date('2026-03-14T05:00:00Z'), { clock: () => now, naverClock, emailTransport: mail }); } finally { g.resetFaults(); }
      assert.ok(sends.length > 0, '발송했다(감시 불가 알림)');
      assert.ok(sends[0].at < 240_000, `발송 시작 ${sends[0].at}ms < 240초`);
      assert.ok(sends[0].at <= WORK_WINDOW_MS, `네이버 작업은 창(${WORK_WINDOW_MS}ms) 안에서 끝난다: ${sends[0].at}`);
      assert.ok(now - t0 < 300_000, `실행 ${now - t0}ms < 300초`);
    });

    await t.test('(d) an exception outside the account loop still flushes, then rethrows', async () => {
      await queueAlert(g.accountId, 'ads.cap_100', { seeded: true }, { now: () => new Date('2026-03-13T03:00:00Z') });
      sends.length = 0;
      const real = client.adAccount;
      Object.defineProperty(client, 'adAccount', { configurable: true, value: new Proxy(real, { get: (o, k) => (k === 'findMany' ? () => Promise.reject(new Error('db_down')) : o[k]) }) });
      try {
        await assert.rejects(g.runGuard(new Date('2026-03-13T03:00:00Z'), { emailTransport: mail }), /db_down/);
      } finally { Object.defineProperty(client, 'adAccount', { configurable: true, value: real }); }
      assert.ok(sends.length >= 1, '루프 밖 예외여도 발송했다');
    });
  } finally {
    for (const k of ['RESEND_API_KEY', 'ADS_ALERT_FROM', 'ADS_ALERT_EMAILS']) delete process.env[k];
    await g.close();
  }
});
