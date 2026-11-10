/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process, console, Response */
// 성과 수집 규모(최종 판정 A4): 묶음마다 다중 행 INSERT … ON CONFLICT 1문(행마다 upsert 아님), 같은 id 행은 합산,
// 2,000개 상한·시간 예산의 시작 위치를 날마다 돌린다(같은 꼬리가 늘 빠지지 않게), 잘리면 개수를 담은 로그 1줄.
// 실DB(PGlite) + 가짜 네이버. 훅·스파이는 기록·시계 이동만 한다 — 단언은 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupApplyEnv } = require('./fixtures/apply-env.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;
const kw = (i) => `nkw-a001-01-${String(i).padStart(9, '0')}`;
const DAY = (d) => new Date(`2026-04-${d}T21:00:00Z`); // KST 다음 날 06:00 → 어제 = 04-d
const ymd = (d) => `2026-04-${d}`;

test('stats sync batches writes and rotates what a cap drops', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async (t) => {
  const a = await setupApplyEnv(packageDir);
  const { client } = a.env;
  const S = a.naver.state;
  const { syncStats, MAX_ENTITIES, ID_CHUNK, rotationOf } = require('../sync-stats.ts');
  const addKeywords = (from, to) => client.adKeyword.createMany({ data: Array.from({ length: to - from }, (_, j) => ({
    ownerId: 'owner', adAccountId: a.accountId, naverId: kw(from + j), name: kw(from + j), keyword: `k${from + j}`,
  })) });
  const statRows = (ids, salesAmt) => new Map(ids.map((id) => [id, { impCnt: 3, clkCnt: 1, salesAmt, ccnt: 0, avgRnk: 2 }]));
  const spy = { upsert: 0, executeRaw: 0 };
  const realUpsert = client.adPerformanceDaily.upsert.bind(client.adPerformanceDaily), realExec = client.$executeRaw.bind(client);
  client.adPerformanceDaily.upsert = (...x) => { spy.upsert++; return realUpsert(...x); };
  client.$executeRaw = (...x) => { spy.executeRaw++; return realExec(...x); };
  const logs = [];
  const original = { error: console.error, warn: console.warn };
  console.warn = (...x) => logs.push(x);
  const requested = (from) => S.calls.slice(from).filter((c) => c.path === '/stats').flatMap((c) => c.query.ids.split(','));
  try {
    await addKeywords(0, 120);
    const ids120 = Array.from({ length: 120 }, (_, i) => kw(i));

    await t.test('one multi-row INSERT … ON CONFLICT per batch; duplicate rows are summed; re-run is idempotent', async () => {
      const rows = statRows(ids120, 10);
      S.dailyStats.set(ymd('10'), rows);
      S.hooks.after = (c) => (c.path === '/stats' && c.query.ids.split(',').includes(kw(0))
        ? Response.json({ data: [...c.query.ids.split(',').map((id) => ({ id, ...rows.get(id) })), { id: kw(0), impCnt: 2, clkCnt: 1, salesAmt: 5, ccnt: 1, avgRnk: 4 }] })
        : undefined);
      let s;
      try { s = await syncStats(1, DAY('10')); } finally { a.resetFaults(); }
      assert.equal(s.accounts[0].outcome, 'ok', JSON.stringify(s));
      assert.deepEqual([spy.upsert, spy.executeRaw], [0, 3], '키워드 120개 = 묶음 3개 = INSERT 3문(행별 upsert 0)');
      assert.equal(await client.adPerformanceDaily.count(), 120);
      const k0 = await client.adPerformanceDaily.findFirstOrThrow({ where: { naverId: kw(0) } });
      assert.deepEqual([k0.entityType, k0.ownerId, k0.impCnt, k0.clkCnt, k0.costKrw, k0.ccnt], ['keyword', 'owner', 5, 2, 15, 1], '같은 id 행 합산');
      S.dailyStats.set(ymd('10'), statRows(ids120, 20));
      await syncStats(1, DAY('10'));
      assert.equal(await client.adPerformanceDaily.count(), 120, '재수집해도 행이 늘지 않는다');
      assert.equal((await client.adPerformanceDaily.findFirstOrThrow({ where: { naverId: kw(119) } })).costKrw, 20, '값은 갱신');
      assert.equal(logs.length, 0, '잘리지 않았으면 잘림 로그 없음');
    });

    await addKeywords(120, 2100);
    const all = Array.from({ length: 2100 }, (_, i) => kw(i));

    await t.test('the 2,000-keyword cap rotates daily (two days cover all) and logs the counts', async () => {
      const seen = [];
      for (const d of ['11', '12']) {
        S.dailyStats.set(ymd(d), statRows(all, 1));
        const from = S.calls.length;
        await syncStats(1, DAY(d));
        seen.push(new Set(requested(from)));
      }
      assert.deepEqual(seen.map((x) => x.size), [MAX_ENTITIES, MAX_ENTITIES]);
      assert.notDeepEqual([...seen[0]].sort(), [...seen[1]].sort(), '날마다 다른 창');
      assert.equal(new Set([...seen[0], ...seen[1]]).size, 2100, '이틀이면 모든 키워드를 한 번은 수집');
      const cap = logs.filter((x) => x[0] === '[ads] stats sync truncated');
      assert.equal(cap.length, 2);
      assert.deepEqual(cap[0][1].entityCap, { keyword: { total: 2100, kept: 2000 } });
      assert.equal(cap[0][1].skippedBatches, 0);
    });

    await t.test('the time budget skips a different set of batches each day and logs how many', async () => {
      logs.length = 0;
      let clock = 0;
      S.hooks.before = (c) => { if (c.path === '/stats') clock += 1_000; return undefined; };
      const firsts = [];
      try {
        for (const d of ['13', '14']) {
          S.dailyStats.set(ymd(d), statRows(all, 1));
          const from = S.calls.length;
          const s = await syncStats(1, DAY(d), { clock: () => clock, budgetMs: 5_500 });
          assert.equal(s.accounts[0].skippedBatches, 34, JSON.stringify(s));
          firsts.push(requested(from)[0]);
        }
      } finally { a.resetFaults(); }
      assert.notEqual(firsts[0], firsts[1], '시작 묶음이 날마다 다르다');
      // 시작 묶음 = 그날 창(2,000개, 시작 = rotation×2000 mod 2100)의 (rotation mod 40)번째 묶음 — 창 회전과 별개로 묶음도 돈다
      const expected = ['13', '14'].map((d) => { const r = rotationOf(DAY(d)); return all[((r * MAX_ENTITIES) % 2100 + (r % 40) * ID_CHUNK) % 2100]; });
      assert.deepEqual(firsts, expected);
      assert.ok(['13', '14'].some((d) => rotationOf(DAY(d)) % 40 !== 0), '검사가 의미 있으려면 적어도 하루는 0번 묶음이 아니어야 한다');
      const cut = logs.filter((x) => x[0] === '[ads] stats sync truncated');
      assert.deepEqual(cut.map((x) => [x[1].skippedBatches, x[1].totalBatches]), [[34, 40], [34, 40]]);
    });
  } finally {
    Object.assign(console, original);
    await a.env.close();
  }
});
