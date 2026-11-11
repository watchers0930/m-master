/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 감시 크론 — 상한 90%·100%(Task 11). 실DB(PGlite) + 가짜 네이버. 시각은 주입한다.
// - 90%: 알림 1회/일. 100%: 네이버에서 새로 읽어 켜진 캠페인만 끈다(미러 없는 캠페인 포함). lockedBy null → guard, owner·pending_launch는 그대로.
// - 비상 정지 스위치(ADS_EXECUTION_ENABLED)·파이프라인 스위치가 꺼져 있어도 끈다. 한 계정의 오류·키 무효 계정은 루프를 멈추지 않는다.
// 훅은 기록·장애 주입만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupGuardEnv, D, T } = require('./fixtures/guard-env.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;

test('ads guard cap thresholds on a real database', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async (t) => {
  const g = await setupGuardEnv(packageDir, 3);
  const { client } = g.env;
  const [c0, c1, c2] = g.camps;
  try {
    await g.launch(c0);
    await client.adCampaign.update({ where: { id: c1.id }, data: { lockedBy: 'owner' } });
    const before = { c1: await g.row(c1), c2: await g.row(c2) };

    await t.test('cap 90 alerts once per day', async () => {
      g.daySpend(D, { [c0.naverId]: 8999.9 });
      let s = await g.runGuard(T.LOCK);
      assert.equal(s.accounts[0].outcome, 'ok', JSON.stringify(s));
      assert.equal(s.accounts[0].todayCostKrw, 8999.9);
      assert.equal((await g.alerts('ads.cap_90')).length, 0, '90% 미만은 알림 없음');
      g.daySpend(D, { [c0.naverId]: 9000 });
      s = await g.runGuard(T.LOCK2);
      assert.equal(s.accounts[0].todayCostKrw, 9000);
      s = await g.runGuard(new Date('2026-03-10T06:00:00Z'));
      assert.equal(s.accounts[0].todayCostKrw, 9000);
      const al = await g.alerts('ads.cap_90');
      assert.deepEqual(al.map((x) => [x.kstDate, x.payload.todayCostKrw, x.payload.dailyCapKrw]), [[D, 9000, 10000]], '같은 날 1회');
      assert.equal((await g.alerts('ads.cap_100')).length, 0);
      assert.equal(g.pausePuts(c0.naverId), 0, '90%는 끄지 않는다');
      assert.equal(g.naverCamp(c0.naverId).userLock, false);
      const again = await g.runGuard(new Date('2026-03-10T06:00:00Z'));
      assert.equal(again.skipped, 'already_claimed', '같은 30분 칸의 두 번째 실행은 아무것도 하지 않는다');
      assert.deepEqual(again.accounts, []);
    });

    await t.test('cap 100 locks only lit campaigns as guard; switches off; bad accounts do not stop the loop', async () => {
      // 오류 계정(복호화 불가)과 키 무효 계정이 먼저 온다(createdAt 순)
      const early = new Date('2026-01-01T00:00:00Z');
      const bad = await client.adAccount.create({ data: { ownerId: 'owner', naverCustomerId: '7000001', label: 'bad', apiKeyEnc: 'v1:broken', secretKeyEnc: 'v1:broken', keyLast4: 'zzzz', createdAt: early } });
      const inv = await client.adAccount.create({ data: { ownerId: 'owner', naverCustomerId: '7000002', label: 'inv', status: 'invalid_key', apiKeyEnc: 'v1:x', secretKeyEnc: 'v1:x', keyLast4: 'yyyy', createdAt: early } });
      // 미러 없는 켜진 캠페인(네이버 화면에서 직접 만든 것) + 대장이 잠근 것으로 기록됐지만 네이버에서는 켜진 캠페인
      g.S.campaigns.push({ nccCampaignId: 'cmp-manual-0001', name: 'manual', userLock: false, status: 'ELIGIBLE' });
      g.naverCamp(c1.naverId).userLock = false;
      g.daySpend(D, { [c0.naverId]: 6000, 'cmp-manual-0001': 4000 });
      process.env.ADS_EXECUTION_ENABLED = 'false';
      delete process.env.PIPELINE_AUTOMATION_ENABLED;
      const r0 = await g.row(c0);
      const now = new Date('2026-03-10T07:00:00Z');
      let s;
      try { s = await g.runGuard(now); } finally { process.env.ADS_EXECUTION_ENABLED = 'true'; }
      const by = Object.fromEntries(s.accounts.map((x) => [x.accountId, x]));
      assert.deepEqual([by[bad.id].outcome, by[inv.id].outcome, by[inv.id].reason], ['error', 'skipped', 'invalid_key'], JSON.stringify(s));
      assert.equal(by[g.accountId].outcome, 'ok', '앞 계정의 오류가 루프를 멈추지 않는다');
      assert.equal(by[g.accountId].todayCostKrw, 10000);
      assert.equal(g.S.calls.filter((c) => c.headers['X-Customer'] === '7000002').length, 0, '키 무효 계정은 네이버 호출 0');
      assert.deepEqual((await client.adAlert.findMany({ where: { adAccountId: inv.id } })).map((x) => x.type), ['ads.key_invalid']);

      for (const id of [c0.naverId, c1.naverId, 'cmp-manual-0001']) assert.equal(g.naverCamp(id).userLock, true, `${id} 꺼짐`);
      assert.equal(g.pausePuts(c2.naverId), 0, '이미 꺼진 캠페인은 건드리지 않는다');
      const a0 = await g.row(c0), a1 = await g.row(c1), a2 = await g.row(c2);
      assert.deepEqual([a0.lockedBy, a0.lockVersion, a0.lockedAt?.toISOString(), a0.userLock], ['guard', r0.lockVersion + 1, now.toISOString(), true]);
      assert.deepEqual([a1.lockedBy, a1.userLock], ['owner', true], '대장 잠금은 guard로 바꾸지 않는다(다음 날 자동 재개 대상 아님)');
      assert.deepEqual([a2.lockedBy, a2.lockVersion, a2.updatedAt.getTime()], ['pending_launch', before.c2.lockVersion, before.c2.updatedAt.getTime()]);
      const cap = await g.alerts('ads.cap_100');
      assert.equal(cap.length, 1);
      assert.deepEqual([cap[0].payload.todayCostKrw, cap[0].payload.paused, cap[0].payload.unmirrored, cap[0].payload.pauseFailed], [10000, 3, 1, 0]);
      assert.equal((await g.alerts('ads.pause_failed')).length, 0);
      const ops = await client.adOperationLog.findMany({ where: { step: { startsWith: 'guard.' } } });
      assert.equal(ops.length, 3, '모든 끄기는 원장을 거친다');
      assert.ok(ops.every((o) => o.method === 'PUT' && o.status === 'ok'));
    });

    await t.test('pipeline kill switch does not stop guard (cron route, real clock)', async () => {
      const route = require('../../../app/api/cron/ads-guard/route.ts');
      const { kstDate } = require('../alerts.ts');
      const { request } = require('./fixtures/ads-db.cjs');
      process.env.CRON_SECRET = 'cron-secret-for-tests-0001';
      process.env.PIPELINE_AUTOMATION_ENABLED = 'false';
      const n0 = g.S.calls.length;
      let res = await route.GET(request('GET', '/api/cron/ads-guard'));
      assert.equal(res.status, 401, '비밀값 없으면 401');
      assert.equal(g.S.calls.length, n0, '인증 실패면 네이버 호출 0');
      await g.launch(c2);
      g.daySpend(kstDate(new Date()), { [c2.naverId]: 15000 });
      const req = request('GET', '/api/cron/ads-guard');
      req.headers.set('authorization', 'Bearer cron-secret-for-tests-0001');
      res = await route.GET(req);
      const text = await res.text();
      assert.equal(res.status, 200, text);
      for (const needle of ['apiKey', 'secretKey', 'v1:', 'Enc']) assert.equal(text.includes(needle), false, `응답에 ${needle} 없음`);
      assert.equal(g.naverCamp(c2.naverId).userLock, true, '파이프라인 스위치가 꺼져도 감시는 끈다');
      assert.equal((await g.row(c2)).lockedBy, 'guard');
      delete process.env.PIPELINE_AUTOMATION_ENABLED;
      delete process.env.CRON_SECRET;
    });
  } finally {
    await g.close();
  }
});
