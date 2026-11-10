/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 제안 적용 재개 안전(Review Focus 2) — 실DB(PGlite) + 가짜 네이버: 중간 실패 후 재개해도 중복 0, 불확실 POST는 재전송 없이
// 결정적 이름(키워드 문자열·소재 내용)으로 대조, 멈춘 applying 회수(10분). 훅은 기록·장애 주입만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupApplyEnv } = require('./fixtures/apply-env.cjs');
const { json } = require('./fixtures/fake-naver.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;
const MIN = 60_000;

test('ads apply resume safety on a real database', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async (t) => {
  const a = await setupApplyEnv(packageDir);
  const { env, naver, approved, apply, posts, mirrors, proposalRow, resetFaults } = a;
  const { client } = env;
  const { applyProposal } = require('../apply.ts');
  // 이 제안이 네이버에 만든 엔티티 수(이름·부모 기준) — 중복이면 1보다 커진다
  const created = async (pid) => {
    const camps = naver.state.campaigns.filter((c) => c.name === `mq-${pid}`);
    const groups = naver.state.adgroups.filter((g) => camps.some((c) => c.nccCampaignId === g.nccCampaignId));
    const kws = naver.state.keywords.filter((x) => groups.some((g) => g.nccAdgroupId === x.nccAdgroupId));
    const ads = naver.state.ads.filter((x) => groups.some((g) => g.nccAdgroupId === x.nccAdgroupId));
    return { camps: camps.length, groups: groups.map((g) => g.name).sort(), kws: kws.map((x) => x.keyword).sort(), ads: ads.length };
  };
  const FULL = (pid) => ({ camps: 1, groups: [`mq-${pid}-g1`, `mq-${pid}-g2`], kws: ['깡통전세', '등기부등본', '전세사기'], ads: 4 });
  try {
    await t.test('resume after mid-apply failure creates no duplicates', async (t2) => {
      await t2.test('rejected keyword (3909) → apply_failed with lint rule id → resume finishes once', async () => {
        const p = await approved();
        let seen = 0;
        naver.state.hooks.before = (c) => (c.method === 'POST' && c.path === '/ncc/keywords' && ++seen === 2 ? json(400, { code: 3909, title: 'forbidden' }) : undefined);
        try {
          const r = await apply(p.id);
          assert.deepEqual([r.body.data.status, r.body.data.failCode], ['apply_failed', 'lint:forbidden-keyword']);
        } finally { resetFaults(); }
        const r = await apply(p.id);
        assert.equal(r.body.data.status, 'applied', JSON.stringify(r.body));
        assert.deepEqual(await created(p.id), FULL(p.id));
        const m = await mirrors(p.id);
        assert.deepEqual([m.campaigns.length, m.groups.length, m.keywords.length, m.creatives.length], [1, 2, 3, 4]);
      });

      await t2.test('crash after successful POSTs (mirror rows missing) → resume adopts from the oplog, zero POSTs', async () => {
        const p = await approved();
        assert.equal((await apply(p.id)).body.data.status, 'applied');
        await client.adKeyword.deleteMany({ where: { proposalId: p.id } });
        await client.adCreative.deleteMany({ where: { proposalId: p.id } });
        await client.adProposal.update({ where: { id: p.id }, data: { status: 'apply_failed', failCode: 'ads_unavailable' } });
        const n0 = naver.state.calls.filter((c) => c.method === 'POST').length;
        // 목록 조회를 막는다 → 원장(oplog)의 ok naverId만으로 채택해야 한다
        naver.state.hooks.before = (c) => (c.method === 'GET' && (c.path === '/ncc/keywords' || c.path === '/ncc/ads') ? json(503, {}) : undefined);
        let r;
        try { r = await apply(p.id); } finally { resetFaults(); }
        assert.equal(r.body.data.status, 'applied', JSON.stringify(r.body));
        assert.equal(naver.state.calls.filter((c) => c.method === 'POST').length, n0, 'POST 0');
        const m = await mirrors(p.id);
        assert.deepEqual([m.keywords.length, m.creatives.length], [3, 4]);
        assert.ok([...m.keywords, ...m.creatives].every((x) => x.lockedBy === 'pending_launch' && x.userLock));
        assert.deepEqual(await created(p.id), FULL(p.id));
      });

      await t2.test('read-back GET fails after a created group → resume adopts that group, no second POST', async () => {
        const p = await approved();
        let groupGets = 0;
        naver.state.hooks.before = (c) => (c.method === 'GET' && /^\/ncc\/adgroups\/[^/]+$/.test(c.path) && ++groupGets >= 2 ? json(503, {}) : undefined);
        try {
          const r = await apply(p.id);
          assert.deepEqual([r.body.data.status, r.body.data.failCode], ['apply_failed', 'ads_unavailable']);
        } finally { resetFaults(); }
        assert.equal((await mirrors(p.id)).groups.length, 1);
        const g0 = posts(/^\/ncc\/adgroups$/);
        assert.equal((await apply(p.id)).body.data.status, 'applied');
        assert.equal(posts(/^\/ncc\/adgroups$/), g0, '그룹 재전송 없음');
        assert.deepEqual(await created(p.id), FULL(p.id));
      });

      await t2.test('stuck applying: young claim → 409, older than 10 minutes → taken over', async () => {
        const p = await approved();
        // 시각은 JS Date로 쓴다(timestamp without time zone + DB now()는 세션 시간대에 따라 어긋난다)
        await client.adProposal.update({ where: { id: p.id }, data: { status: 'applying', updatedAt: new Date(Date.now() - 5 * MIN) } });
        const calls0 = naver.state.calls.length;
        let r = await apply(p.id);
        assert.deepEqual([r.status, r.body.error.code], [409, 'apply_in_progress']);
        assert.equal(naver.state.calls.length, calls0);
        await client.adProposal.update({ where: { id: p.id }, data: { updatedAt: new Date(Date.now() - 11 * MIN) } });
        r = await apply(p.id);
        assert.equal(r.body.data.status, 'applied');
        assert.deepEqual(await created(p.id), FULL(p.id));
      });

      await t2.test('claim taken over mid-run (token lost) → this run stops before the next write, 409', async () => {
        const p = await approved();
        naver.state.hooks.after = async (c) => {
          if (c.method === 'POST' && c.path === '/ncc/campaigns') await client.adProposal.update({ where: { id: p.id }, data: { updatedAt: new Date(Date.now() + 60_000) } });
        };
        const n0 = naver.state.calls.filter((c) => c.method === 'POST').length;
        let r;
        try { r = await apply(p.id); } finally { resetFaults(); }
        assert.deepEqual([r.status, r.body.error?.code], [409, 'apply_conflict']);
        assert.deepEqual(naver.state.calls.filter((c) => c.method === 'POST').slice(n0).map((c) => c.path), ['/ncc/campaigns'], '점유를 잃은 뒤 쓰기 0');
        assert.equal((await proposalRow(p.id)).status, 'applying', '결과 기록은 점유한 쪽 몫');
      });

      await t2.test('claim is a CAS: row changed after the lock read → 409, nothing sent', async () => {
        const p = await approved();
        const calls0 = naver.state.calls.length;
        const bump = async (tx, row) => { await tx.$executeRawUnsafe(`UPDATE ad_proposals SET updated_at = updated_at + interval '5 ms' WHERE id = $1`, row.id); };
        await assert.rejects(applyProposal('owner', p.id, { afterLock: bump }), (e) => e.code === 'apply_conflict' && e.status === 409);
        assert.equal(naver.state.calls.length, calls0);
        assert.equal((await proposalRow(p.id)).status, 'approved');
      });
    });

    await t.test('uncertain POST reconciled by name, never resent', async (t2) => {
      await t2.test('campaign POST 502 but stored → found by name mq-{id}, one POST', async () => {
        const p = await approved();
        const c0 = posts(/^\/ncc\/campaigns$/);
        naver.state.hooks.after = (c) => (c.method === 'POST' && c.path === '/ncc/campaigns' ? json(502, {}) : undefined);
        try {
          const r = await apply(p.id);
          assert.equal(r.body.data.status, 'applied', JSON.stringify(r.body));
        } finally { resetFaults(); }
        assert.equal(posts(/^\/ncc\/campaigns$/) - c0, 1);
        assert.deepEqual(await created(p.id), FULL(p.id));
        const log = await client.adOperationLog.findFirst({ where: { proposalId: p.id, path: '/ncc/campaigns' } });
        assert.equal(log.status, 'uncertain');
      });

      await t2.test('keyword POST 200 with unparseable body → uncertain → matched by keyword text, no resend', async () => {
        const p = await approved();
        const k0 = posts(/^\/ncc\/keywords$/);
        let n = 0;
        naver.state.hooks.after = (c) => (c.method === 'POST' && c.path === '/ncc/keywords' && ++n === 1 ? json(200, { weird: true }) : undefined);
        try {
          assert.equal((await apply(p.id)).body.data.status, 'applied');
        } finally { resetFaults(); }
        assert.equal(posts(/^\/ncc\/keywords$/) - k0, 3);
        assert.deepEqual(await created(p.id), FULL(p.id));
      });

      await t2.test('ad POST 500 not stored → stays uncertain (no resend), resume within settle window still refuses, later creates once', async () => {
        const p = await approved();
        const ad0 = posts(/^\/ncc\/ads$/);
        let n = 0;
        naver.state.hooks.before = (c) => (c.method === 'POST' && c.path === '/ncc/ads' && ++n === 1 ? json(500, {}) : undefined);
        let r;
        try {
          r = await apply(p.id);
        } finally { resetFaults(); }
        assert.deepEqual([r.body.data.status, r.body.data.failCode], ['apply_failed', 'uncertain:ad:g1:a1']);
        assert.equal(posts(/^\/ncc\/ads$/) - ad0, 1, '재전송 없음');
        r = await apply(p.id);
        assert.deepEqual([r.body.data.status, r.body.data.failCode], ['apply_failed', 'uncertain:ad:g1:a1'], '대기 시간 안: 다시 보내지 않는다');
        assert.equal(posts(/^\/ncc\/ads$/) - ad0, 1);
        const later = await applyProposal('owner', p.id, { now: () => new Date(Date.now() + 3 * MIN) });
        assert.equal(later.status, 'applied');
        assert.equal(posts(/^\/ncc\/ads$/) - ad0, 5, '불확실 1 + 생성 4(대조로 없음 확인 뒤 1회만)');
        assert.deepEqual(await created(p.id), FULL(p.id));
      });

      await t2.test('two entities match the deterministic name → ambiguous, nothing adopted', async () => {
        const p = await approved();
        naver.state.campaigns.push({ nccCampaignId: 'cmp-preexisting-1', name: `mq-${p.id}`, userLock: true, status: 'PAUSED' });
        naver.state.hooks.after = (c) => (c.method === 'POST' && c.path === '/ncc/campaigns' ? json(504, {}) : undefined);
        try {
          const r = await apply(p.id);
          assert.deepEqual([r.body.data.status, r.body.data.failCode], ['apply_failed', 'ambiguous:campaign']);
        } finally { resetFaults(); }
        assert.equal((await mirrors(p.id)).campaigns.length, 0);
      });
    });
  } finally {
    delete process.env.ADS_EXECUTION_ENABLED;
    await env.close();
  }
});
