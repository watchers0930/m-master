/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 심사 동기화(syncInspect)·성과 수집(syncStats) — 실DB(PGlite) + 가짜 네이버(Task 11).
// - 심사: 검수 중(null·PENDING·UNDER_REVIEW) 키워드·소재만 ids 묶음 조회. inspectStatus·lastSyncedAt만 바꾼다(잠금 컬럼 금지). DENIED로 바뀌면 알림.
// - 성과: 캠페인·그룹·키워드 × 최근 7일(KST, 어제부터) /stats → AdPerformanceDaily upsert. 재수집해도 행이 늘지 않는다. 형식 오류 묶음은 건너뛴다(0을 쓰지 않음).
// - 키 무효 계정은 건너뛴다(호출 0). 훅은 기록·장애 주입만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupApplyEnv } = require('./fixtures/apply-env.cjs');
const { json } = require('./fixtures/fake-naver.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;

test('ads inspect/stats sync on a real database', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async (t) => {
  const a = await setupApplyEnv(packageDir);
  const { client } = a.env;
  const S = a.naver.state;
  try {
    const { syncInspect } = require('../sync-inspect.ts');
    const { syncStats } = require('../sync-stats.ts');
    const p = await a.approved();
    assert.equal((await a.apply(p.id)).body.data.status, 'applied');
    const m = await a.mirrors(p.id);
    const calls = (path) => S.calls.filter((c) => c.method === 'GET' && c.path === path);

    await t.test('inspect sync updates only inspectStatus/lastSyncedAt and alerts DENIED', async () => {
      const [k0, k1, k2] = m.keywords, [ad0, ad1] = m.creatives;
      const lockedAt = new Date('2026-02-01T00:00:00Z');
      await client.adKeyword.update({ where: { id: k0.id }, data: { lockVersion: 7, lockedBy: 'owner', lockedAt, userLock: false } });
      const before = await client.adKeyword.findUniqueOrThrow({ where: { id: k0.id } });
      const nk = (id) => S.keywords.find((x) => x.nccKeywordId === id), na = (id) => S.ads.find((x) => x.nccAdId === id);
      nk(k0.naverId).inspectStatus = 'APPROVED';
      nk(k1.naverId).inspectStatus = 'DENIED';
      na(ad0.naverId).inspectStatus = 'DENIED';
      na(ad1.naverId).inspectStatus = 'ELIGIBLE';
      nk(k0.naverId).userLock = true; // 네이버 잠금이 달라도 동기화는 잠금을 건드리지 않는다
      const now = new Date('2026-03-10T03:00:00Z');
      const s = await syncInspect(now);
      assert.equal(s.accounts[0].outcome, 'ok', JSON.stringify(s));
      const kwCall = calls('/ncc/keywords').at(-1);
      assert.deepEqual(kwCall.query.ids.split(',').sort(), m.keywords.map((k) => k.naverId).sort(), '키워드는 ids 묶음 1회');
      assert.equal(calls('/ncc/ads').filter((c) => c.query.ids !== undefined).length, 1, '소재도 ids 묶음 1회');
      const after = await client.adKeyword.findUniqueOrThrow({ where: { id: k0.id } });
      assert.equal(after.inspectStatus, 'APPROVED');
      assert.equal(after.lastSyncedAt?.toISOString(), now.toISOString());
      for (const f of ['lockVersion', 'lockedBy', 'userLock', 'proposalId', 'naverId', 'bidAmt', 'keyword'])
        assert.deepEqual(after[f], before[f], `동기화는 ${f}를 건드리지 않는다`);
      assert.equal(after.lockedAt?.toISOString(), lockedAt.toISOString());
      assert.equal((await client.adKeyword.findUniqueOrThrow({ where: { id: k1.id } })).inspectStatus, 'DENIED');
      assert.equal((await client.adKeyword.findUniqueOrThrow({ where: { id: k2.id } })).inspectStatus, 'UNDER_REVIEW');
      assert.equal((await client.adCreative.findUniqueOrThrow({ where: { id: ad1.id } })).inspectStatus, 'ELIGIBLE');
      const al = await client.adAlert.findMany({ where: { type: 'ads.inspect_denied' } });
      assert.equal(al.length, 2, '반려 엔티티마다 1건');
      assert.deepEqual(al.map((x) => [x.kstDate, x.payload.entity, x.dedupeKey]).sort(), [['2026-03-10', 'ad', ad0.naverId], ['2026-03-10', 'keyword', k1.naverId]].sort());

      // 다시 돌면 검수 중인 것만 묻는다. 소재 응답이 형식 오류면 그 묶음은 건너뛴다(값을 지우지 않는다)
      a.resetFaults();
      S.hooks.after = (c) => (c.path === '/ncc/ads' && c.query.ids !== undefined ? json(200, { not: 'a list' }) : undefined);
      na(m.creatives[2].naverId).inspectStatus = 'APPROVED';
      let s2;
      try { s2 = await syncInspect(new Date('2026-03-10T03:30:00Z')); } finally { a.resetFaults(); }
      assert.equal(s2.accounts[0].outcome, 'ok');
      assert.deepEqual(calls('/ncc/keywords').at(-1).query.ids.split(','), [k2.naverId], '이미 끝난 심사는 다시 묻지 않는다');
      assert.equal((await client.adCreative.findUniqueOrThrow({ where: { id: m.creatives[2].id } })).inspectStatus, 'UNDER_REVIEW', '형식 오류 묶음은 쓰지 않는다');
      assert.equal((await client.adCreative.findUniqueOrThrow({ where: { id: ad1.id } })).inspectStatus, 'ELIGIBLE', '기존 값을 지우지 않는다');
    });

    await t.test('stats upsert is idempotent over 7-day refetch', async () => {
      const ids = { campaign: m.campaigns.map((x) => x.naverId), adgroup: m.groups.map((x) => x.naverId), keyword: m.keywords.map((x) => x.naverId) };
      const all = [...ids.campaign, ...ids.adgroup, ...ids.keyword];
      const now = new Date('2026-03-10T21:00:00Z'); // KST 03-11 06:00 → 어제 = 03-10
      const days = ['2026-03-10', '2026-03-09', '2026-03-08', '2026-03-07', '2026-03-06', '2026-03-05', '2026-03-04'];
      const fill = (bump = 0) => days.forEach((d, i) => S.dailyStats.set(d, new Map(all.map((id, j) => [id, { impCnt: 100 + i, clkCnt: 10 + j, salesAmt: 1000 * (i + 1) + bump, ccnt: 1, avgRnk: 2.5 }]))));
      S.dailyStats.set('2026-03-11', new Map(all.map((id) => [id, { impCnt: 1, clkCnt: 1, salesAmt: 1, ccnt: 0, avgRnk: 1 }]))); // 오늘(KST)은 수집하지 않는다
      fill();
      const n0 = S.calls.length;
      let s = await syncStats(7, now);
      assert.equal(s.accounts[0].outcome, 'ok', JSON.stringify(s));
      const statCalls = S.calls.slice(n0).filter((c) => c.path === '/stats');
      assert.equal(statCalls.length, 3 * 7, '종류 3 × 7일, 각 ids 묶음 1회');
      assert.deepEqual([...new Set(statCalls.map((c) => JSON.parse(c.query.timeRange).since))].sort(), [...days].sort());
      assert.ok(statCalls.every((c) => { const r = JSON.parse(c.query.timeRange); return r.since === r.until; }));
      const count = () => client.adPerformanceDaily.count();
      assert.equal(await count(), all.length * 7);
      const row = await client.adPerformanceDaily.findFirstOrThrow({ where: { naverId: ids.keyword[0], date: new Date('2026-03-08T00:00:00Z') } });
      assert.deepEqual([row.entityType, row.ownerId, row.adAccountId, row.impCnt, row.costKrw, row.ccnt, row.avgRnk], ['keyword', 'owner', a.accountId, 102, 3000, 1, 2.5]);

      // 재수집: 늦게 확정된 값으로 갱신, 행 수는 그대로. 한 묶음이 형식 오류면 그 묶음은 건너뛴다(0으로 덮지 않음)
      fill(7);
      S.hooks.after = (c) => (c.path === '/stats' && c.query.ids.includes(ids.keyword[0]) && JSON.parse(c.query.timeRange).since === '2026-03-08' ? json(200, { data: [{ id: ids.keyword[0], impCnt: 'x' }] }) : undefined);
      try { s = await syncStats(7, now); } finally { a.resetFaults(); }
      assert.equal(s.accounts[0].skippedBatches, 1);
      assert.equal(await count(), all.length * 7, '중복 행 없음');
      assert.equal((await client.adPerformanceDaily.findUniqueOrThrow({ where: { id: row.id } })).costKrw, 3000, '형식 오류 묶음은 기존 값을 지키고 0을 쓰지 않는다');
      const other = await client.adPerformanceDaily.findFirstOrThrow({ where: { naverId: ids.campaign[0], date: new Date('2026-03-08T00:00:00Z') } });
      assert.equal(other.costKrw, 3007, '다른 묶음은 갱신');
      await assert.rejects(syncStats(0, now), /invalid_days/);
      await assert.rejects(syncStats(31, now), /invalid_days/);
    });

    await t.test('invalid key account skipped', async () => {
      await client.adAccount.update({ where: { id: a.accountId }, data: { status: 'invalid_key' } });
      const n0 = S.calls.length;
      const i = await syncInspect(new Date('2026-03-12T03:00:00Z'));
      const st = await syncStats(7, new Date('2026-03-12T21:00:00Z'));
      assert.equal(S.calls.length, n0, '네이버 호출 0');
      assert.deepEqual([i.accounts.length, st.accounts.length], [0, 0]);
      await client.adAccount.update({ where: { id: a.accountId }, data: { status: 'active' } });
    });
  } finally {
    delete process.env.ADS_EXECUTION_ENABLED;
    await a.env.close();
  }
});
