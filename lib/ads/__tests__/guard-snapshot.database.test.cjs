/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 감시 스냅샷(Task 12 판정): runGuard가 계정마다 마지막 관찰을 AdAccount에 남긴다 — 화면(/ads)은 네이버를 부르지 않고 이것을 읽는다.
// - lastGuardAt = 주입된 now, lastSpendKrw = 오늘 비용(모르면 null — 0으로 쓰지 않는다), lastBizmoneyKrw = 비즈머니(못 읽으면 null).
// - 키 무효 계정도 감시가 본 시각과 '모름'을 남긴다. 시간 예산으로 건너뛴 계정은 건드리지 않는다(이전 값 유지).
// 훅은 기록·장애 주입만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupGuardEnv } = require('./fixtures/guard-env.cjs');
const { json } = require('./fixtures/fake-naver.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;

test('ads guard writes the account snapshot', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async (t) => {
  const g = await setupGuardEnv(packageDir, 1);
  const { client } = g.env;
  const [c0] = g.camps;
  const snap = async (id = g.accountId) => {
    const r = await client.adAccount.findUniqueOrThrow({ where: { id }, select: { lastGuardAt: true, lastSpendKrw: true, lastBizmoneyKrw: true } });
    return [r.lastGuardAt?.toISOString() ?? null, r.lastSpendKrw, r.lastBizmoneyKrw];
  };
  try {
    await t.test('known spend and bizmoney are recorded with the run time', async () => {
      assert.deepEqual(await snap(), [null, null, null]);
      const now = new Date('2026-05-01T03:00:00Z');
      g.daySpend('2026-05-01', { [c0.naverId]: 12345 });
      g.S.bizmoney = { bizmoney: 2500000, budgetLock: false, refundLock: false };
      await g.runGuard(now);
      assert.deepEqual(await snap(), [now.toISOString(), 12345, 2500000]);
    });

    await t.test('idle campaigns reported as 0-amount rows are a real 0', async () => {
      const now = new Date('2026-05-02T03:00:00Z');
      await g.runGuard(now);
      assert.deepEqual(await snap(), [now.toISOString(), 0, 2500000]);
    });

    await t.test('a valid but EMPTY stats reply for requested ids is unknown (null, guard_blind spend_unknown), never 0', async () => {
      const now = new Date('2026-05-02T09:00:00Z');
      g.S.statsOmitIdle = true; // 네이버가 활동 없는 행을 빼고 data:[]를 주는 경우
      try { await g.runGuard(now); } finally { g.S.statsOmitIdle = false; }
      assert.deepEqual(await snap(), [now.toISOString(), null, 2500000]);
      const blind = (await g.alerts('ads.guard_blind')).filter((a) => a.payload?.reason === 'spend_unknown');
      assert.equal(blind.length, 1);
    });

    await t.test('unknown spend overwrites with null (never 0), unreadable bizmoney is null', async () => {
      const now = new Date('2026-05-03T03:00:00Z');
      g.S.hooks.after = (c) => (c.path === '/stats' ? json(200, { rows: [] }) : c.path === '/billing/bizmoney' ? json(200, { other: 1 }) : undefined);
      try { await g.runGuard(now); } finally { g.resetFaults(); }
      assert.deepEqual(await snap(), [now.toISOString(), null, null]);
    });

    await t.test('invalid_key account: seen time, unknown values; time-budget skip keeps the old snapshot', async () => {
      const bad = await client.adAccount.create({ data: {
        ownerId: 'owner', naverCustomerId: '7000200', label: 'bad', apiKeyEnc: 'v1:broken', secretKeyEnc: 'v1:broken', keyLast4: 'zzzz',
        status: 'invalid_key', lastSpendKrw: 999, lastBizmoneyKrw: 999, createdAt: new Date('2099-01-01T00:00:00Z'),
      } });
      const now = new Date('2026-05-04T03:00:00Z');
      await g.runGuard(now);
      assert.deepEqual(await snap(bad.id), [now.toISOString(), null, null]);
      const before = await snap();
      let tick = 0;
      await g.runGuard(new Date('2026-05-04T03:30:00Z'), { budgetMs: 1, clock: () => (tick += 10) });
      assert.deepEqual(await snap(), before, '시간 예산으로 건너뛴 계정은 그대로');
    });
  } finally {
    await g.close();
  }
});
