/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process, __dirname */
// AI 광고 제안 게이트 — 실DB(PGlite): 월 예산 초과 시 생성 429(네이버·LLM·비용 0),
// 잠금 직후 같은 트랜잭션에서 행이 바뀌면 편집·승인의 updateMany CAS가 0행 → 409(부분 쓰기·감사로그 0),
// 잠금 쿼리는 FOR UPDATE + owner_id 범위로 가장 먼저 나간다, 승인은 저장된 lintResult·입찰을 믿지 않고 다시 계산한다.
// 훅(afterLock)은 기록·실행만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setupProposalsEnv, answer, CLEAN, DIRTY } = require('./fixtures/proposals-env.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;

test('ads proposal gates on a real database', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async (t) => {
  const p0 = await setupProposalsEnv(packageDir);
  const { env, naver, llmCalls, answers, input, create, patch, decide, proposalRow, audits, costRows, selectChannel } = p0;
  try {
    const { db, client } = env;
    const { editProposal, reviewProposal } = require('../proposal-review.ts');
    assert.equal((await selectChannel()).status, 200);
    let r;
    const make = async (creatives = CLEAN) => {
      answers.push(answer(creatives));
      if (creatives !== CLEAN) answers.push(answer(creatives)); // 린트 위반 → 교정 1회 → 여전히 위반
      const res = await create(input);
      assert.equal(res.status, 201, JSON.stringify(res.body));
      return res.body.data;
    };
    const conflictOf = async (promise) => { try { await promise; return null; } catch (e) { return e; } };
    const auditCount = async (id) => (await db.query('SELECT count(*)::int n FROM audit_log WHERE target_id=$1', [id])).rows[0].n;
    const fresh = async (id) => (await proposalRow(id)).updatedAt.toISOString();

    await t.test('budget exceeded → 429 before seeds, research or LLM; no cost', async () => {
      await db.exec(`INSERT INTO settings(id, owner_id, budget_monthly) VALUES ('s-owner','owner',1000)`);
      await db.exec(`INSERT INTO cost_ledger(id, owner_id, kind, krw) VALUES ('c-spent','owner','chat',1000)`);
      const before = { llm: llmCalls.length, naver: naver.state.calls.length, cost: (await costRows()).length, proposals: await client.adProposal.count() };
      r = await create(input);
      assert.deepEqual([r.status, r.body.error.code], [429, 'budget_exceeded']);
      assert.equal(r.body.error.message, '월 예산 한도 초과. 설정에서 한도를 조정하세요.', '콘텐츠 생성과 같은 오류 형태');
      assert.deepEqual({ llm: llmCalls.length, naver: naver.state.calls.length, cost: (await costRows()).length, proposals: await client.adProposal.count() }, before);
      await db.exec(`DELETE FROM cost_ledger WHERE id='c-spent'; DELETE FROM settings WHERE id='s-owner'`);
    });

    await t.test('lock query is FOR UPDATE scoped by owner and issued first in the transaction', async () => {
      const p = await make();
      const seen = [];
      const realTx = client.$transaction.bind(client);
      client.$transaction = (fn, opts) => realTx((tx) => fn(new Proxy(tx, { get(target, key) {
        if (key === '$queryRaw') return (strings, ...values) => { seen.push({ sql: strings.join('?'), values }); return target.$queryRaw(strings, ...values); };
        if (typeof key === 'string' && !key.startsWith('$')) seen.push({ model: key });
        const v = target[key];
        return typeof v === 'function' ? v.bind(target) : v;
      } })), opts);
      try {
        await editProposal('owner', p.id, { expected_updated_at: p.updatedAt, payload: answer(CLEAN) });
        const first = seen.length;
        await reviewProposal('owner', p.id, { decision: 'approve', expected_updated_at: await fresh(p.id) });
        for (const log of [seen.slice(0, first), seen.slice(first)]) {
          assert.ok(log[0].sql, `첫 쿼리가 잠금이어야 한다: ${JSON.stringify(log[0])}`);
          assert.match(log[0].sql, /\bFROM ad_proposals\b[\s\S]*\bowner_id\s*=\s*\?[\s\S]*\bFOR UPDATE\b/);
          assert.deepEqual(log[0].values.slice().sort(), [p.id, 'owner'].sort());
        }
      } finally {
        client.$transaction = realTx;
      }
    });

    // 잠금 직후 같은 트랜잭션에서 행을 바꾸는 훅: 메모리의 row는 낡은 채로 남으므로 updateMany WHERE CAS만이 막을 수 있다
    const bump = (sql) => async (tx, row) => { await tx.$executeRawUnsafe(sql, row.id); };
    const BUMP_VERSION = `UPDATE ad_proposals SET updated_at = updated_at + interval '5 ms' WHERE id = $1`;
    const BUMP_STATUS = `UPDATE ad_proposals SET status = 'rejected' WHERE id = $1`;
    for (const [label, sql] of [['version', BUMP_VERSION], ['status', BUMP_STATUS]]) {
      await t.test(`row changed after lock (${label}) → edit and approve CAS hit 0 rows → 409, no partial write, no audit`, async () => {
        const p = await make();
        const before = await proposalRow(p.id);
        const audit0 = await auditCount(p.id);
        const edited = answer(CLEAN);
        edited.groups[0].name = '부분쓰기 금지';
        let e = await conflictOf(editProposal('owner', p.id, { expected_updated_at: p.updatedAt, payload: edited }, { afterLock: bump(sql) }));
        assert.equal(e?.code, 'version_conflict', `edit: ${e?.code ?? 'no error'}`);
        assert.equal(e.status, 409);
        e = await conflictOf(reviewProposal('owner', p.id, { decision: 'approve', expected_updated_at: p.updatedAt }, { afterLock: bump(sql) }));
        assert.equal(e?.code, 'version_conflict', `approve: ${e?.code ?? 'no error'}`);
        e = await conflictOf(reviewProposal('owner', p.id, { decision: 'reject', expected_updated_at: p.updatedAt }, { afterLock: bump(sql) }));
        assert.equal(e?.code, 'version_conflict', `reject: ${e?.code ?? 'no error'}`);
        const after = await proposalRow(p.id);
        assert.deepEqual([after.status, after.updatedAt.getTime(), after.payload, after.lintResult, after.reviewedAt],
          [before.status, before.updatedAt.getTime(), before.payload, before.lintResult, before.reviewedAt], '훅 변경까지 롤백 — 부분 쓰기 없음');
        assert.equal(await auditCount(p.id), audit0, '감사로그 없음');
      });
    }

    await t.test('afterLock is a no-op by default and no route can pass it', async () => {
      const root = path.resolve(__dirname, '../../..');
      const one = fs.readFileSync(path.join(root, 'app/api/ads/proposals/[id]/route.ts'), 'utf8');
      const rev = fs.readFileSync(path.join(root, 'app/api/ads/proposals/[id]/review/route.ts'), 'utf8');
      assert.match(one, /editProposal\(ownerId, id, input\)\)/);
      assert.match(rev, /reviewProposal\(ownerId, id, input\)\)/);
      assert.doesNotMatch(one + rev, /afterLock/);
    });

    await t.test('edit that introduces lint issues stores them (not [])', async () => {
      const p = await make();
      r = await patch(p.id, { expected_updated_at: p.updatedAt, payload: answer(DIRTY) });
      assert.equal(r.status, 200);
      assert.ok(r.body.data.lintIssueCount > 0);
      assert.ok((await proposalRow(p.id)).lintResult.issues.length > 0);
    });

    await t.test('approve ignores a stored empty lintResult and recomputes lint on the payload', async () => {
      const p = await make(DIRTY);
      await db.query(`UPDATE ad_proposals SET lint_result = '{"issues":[],"checkedAt":"2026-11-10T00:00:00.000Z"}'::jsonb WHERE id = $1`, [p.id]);
      r = await decide(p.id, { decision: 'approve', expected_updated_at: await fresh(p.id) });
      assert.deepEqual([r.status, r.body.error.code], [409, 'lint_issues_remain']);
      assert.equal((await proposalRow(p.id)).status, 'pending_review');
    });

    await t.test('approve rechecks every stored bid (out of range written directly to the DB)', async () => {
      for (const [where, value] of [['groups.0.bidAmt', 2001], ['groups.1.keywords.0.bidAmt', 69], ['groups.0.keywords.1.bidAmt', 100000], ['groups.0.bidAmt', 150.5]]) {
        const p = await make();
        const payload = (await proposalRow(p.id)).payload;
        const parts = where.split('.');
        let node = payload;
        for (const k of parts.slice(0, -1)) node = node[k];
        node[parts.at(-1)] = value;
        await db.query('UPDATE ad_proposals SET payload = $1::jsonb WHERE id = $2', [JSON.stringify(payload), p.id]);
        r = await decide(p.id, { decision: 'approve', expected_updated_at: await fresh(p.id) });
        assert.deepEqual([r.status, r.body.error.code, r.body.error.field], [422, 'ads_invariant', where], where);
        assert.equal((await proposalRow(p.id)).status, 'pending_review');
      }
    });

    await t.test('approve uses the current account maxBid (lowered after creation)', async () => {
      const p = await make(); // 입찰 200~500
      await db.exec(`UPDATE ad_accounts SET max_bid_krw = 250`);
      try {
        r = await decide(p.id, { decision: 'approve', expected_updated_at: p.updatedAt });
        assert.deepEqual([r.status, r.body.error.code], [422, 'ads_invariant']);
        assert.equal((await proposalRow(p.id)).status, 'pending_review');
        assert.equal((await audits('ads.proposal_approve')).filter((a) => a.target_id === p.id).length, 0);
      } finally {
        await db.exec(`UPDATE ad_accounts SET max_bid_krw = 2000`);
      }
      r = await decide(p.id, { decision: 'approve', expected_updated_at: p.updatedAt });
      assert.equal(r.status, 200, '상한을 되돌리면 같은 제안이 승인된다(양성 대조)');
    });
  } finally {
    await env.close();
  }
});
