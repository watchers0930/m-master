/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// AI 광고 제안 — 실DB(PGlite) + 가짜 네이버 + 가짜 LLM: 생성 전제(활성·비즈채널)·비용 원장(kind ads)·소유자 복사,
// 편집(린트·입찰 재검증, CAS)·승인/반려(잠금+CAS+감사로그)·린트 남으면 승인 차단·동시 승인/편집 409(Review Focus 4).
// 접근(IDOR)·목록 페이지·비밀 노출은 proposals-access.database.test.cjs.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupProposalsEnv, answer, kw, CLEAN, DIRTY } = require('./fixtures/proposals-env.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;

test('ads proposal review state machine on a real database', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async (t) => {
  const p0 = await setupProposalsEnv(packageDir);
  const { env, naver, llmCalls, answers, accountId, input, create, patch, decide, proposalRow, audits, costRows, selectChannel, limits } = p0;
  try {
    const { db } = env;
    let r;
    await t.test('preconditions: no business channel or not active → 409 with no LLM call, no research, no cost', async () => {
      naver.state.calls.length = 0;
      r = await create(input);
      assert.equal(r.status, 409);
      assert.equal(r.body.error.code, 'ads_account_not_ready');
      assert.equal(llmCalls.length, 0);
      assert.equal(naver.state.calls.length, 0);
      assert.equal((await costRows()).length, 0);
      assert.equal((await selectChannel()).status, 200);
      naver.state.calls.length = 0;
      for (const status of ['invalid_key', 'disconnecting', 'disabled']) {
        await db.exec(`UPDATE ad_accounts SET status='${status}'`);
        r = await create(input);
        assert.deepEqual([r.status, r.body.error.code], [409, 'ads_account_not_ready'], status);
      }
      await db.exec(`UPDATE ad_accounts SET status='active', max_bid_krw=0`);
      assert.deepEqual([(r = await create(input)).status, r.body.error.code], [409, 'ads_account_not_ready'], '깨진 상한값');
      await db.exec(`UPDATE ad_accounts SET status='active', max_bid_krw=2000`);
      assert.equal(llmCalls.length + (await costRows()).length + naver.state.calls.length, 0);
    });

    await t.test('route caps manual seeds (≤25, ≤40 chars) before research; strict input', async () => {
      assert.equal(limits.MAX_MANUAL_SEEDS, limits.MAX_SEEDS);
      assert.equal(limits.MAX_MANUAL_SEED_LENGTH, limits.MAX_KEYWORD_LENGTH);
      naver.state.calls.length = 0;
      for (const bad of [
        { ...input, seeds: Array.from({ length: 26 }, (_, i) => `씨앗${i}`) },
        { ...input, seeds: ['가'.repeat(41)] },
        { ...input, ownerId: 'other' },
        { ...input, kind: 'extend_group' },
        { ...input, targetAdgroupId: 'grp-1' },
      ]) assert.equal((await create(bad)).status, 400, JSON.stringify(bad).slice(0, 60));
      assert.equal(naver.state.calls.length + llmCalls.length, 0);
    });

    let id, version;
    await t.test('create: pending_review, ownerId copied from the account, cost recorded as ads, evidence from stats', async () => {
      answers.push(answer(DIRTY), answer(DIRTY)); // 린트 위반 → 교정 1회 → 여전히 위반(기록)
      r = await create(input);
      assert.equal(r.status, 201, JSON.stringify(r.body));
      const dto = r.body.data;
      ({ id } = dto);
      version = dto.updatedAt;
      assert.equal(llmCalls.length, 2);
      assert.equal(dto.status, 'pending_review');
      assert.ok(dto.lintIssueCount > 0 && dto.lintResult.issues.length === dto.lintIssueCount);
      assert.deepEqual(dto.payload.groups[0].keywords[0].evidence, { qc: 3000, compIdx: '높음', lt10: false });
      assert.deepEqual(dto.payload.groups[0].keywords[1].evidence, { qc: null, compIdx: '중간', lt10: true });
      assert.equal(dto.sourceKeywords.length, 3);
      const saved = await proposalRow(id);
      assert.equal(saved.ownerId, 'owner');
      assert.equal(saved.adAccountId, accountId);
      const costs = await costRows();
      assert.equal(costs.length, 2);
      assert.ok(costs.every((c) => c.owner_id === 'owner'));
      assert.equal(saved.costKrw, costs.reduce((s, c) => s + c.krw, 0));
      assert.equal(naver.count('GET', /^\/keywordstool$/), 1);
      assert.equal(naver.count('POST', /.*/) + naver.count('PUT', /.*/), 0, '제안은 네이버 변이를 하지 않는다');
    });

    await t.test('approve blocked while lint issues remain', async () => {
      r = await decide(id, { decision: 'approve', expected_updated_at: version });
      assert.equal(r.status, 409);
      assert.equal(r.body.error.code, 'lint_issues_remain');
      assert.equal((await proposalRow(id)).status, 'pending_review');
      assert.equal((await audits('ads.proposal_approve')).length, 0);
    });

    await t.test('edit with out-of-range bid rejected', async () => {
      const before = await proposalRow(id);
      for (const bid of [69, 2001, 100000]) {
        const p = answer(CLEAN);
        p.groups[1].keywords[0].bidAmt = bid;
        r = await patch(id, { expected_updated_at: version, payload: p });
        assert.equal(r.status, 422, `bid ${bid}`);
        assert.equal(r.body.error.code, 'ads_invariant');
        assert.equal(r.body.error.field, 'groups.1.keywords.0.bidAmt');
      }
      const p = answer(CLEAN);
      p.groups[0].bidAmt = 150.5;
      assert.equal((await patch(id, { expected_updated_at: version, payload: p })).status, 422);
      assert.equal((await patch(id, { expected_updated_at: version, payload: { ...p, extra: 1 } })).status, 400, 'strict');
      const after = await proposalRow(id);
      assert.deepEqual([after.updatedAt.getTime(), after.payload], [before.updatedAt.getTime(), before.payload], '거부된 편집은 아무것도 바꾸지 않는다');
    });

    await t.test('edit re-lints, overwrites client evidence, then approve succeeds with audit; approved is not editable', async () => {
      const p = answer(CLEAN);
      p.groups[0].keywords[0].evidence = { qc: 1, compIdx: '낮음' }; // 클라이언트 근거는 무시
      p.groups[1].keywords.push(kw('직접 넣은 키워드', 100));
      r = await patch(id, { expected_updated_at: version, payload: p });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.data.lintIssueCount, 0);
      assert.deepEqual(r.body.data.payload.groups[0].keywords[0].evidence, { qc: 3000, compIdx: '높음', lt10: false });
      assert.deepEqual(r.body.data.payload.groups[1].keywords[1].evidence, { qc: null, compIdx: null, lt10: false });
      assert.ok(Date.parse(r.body.data.updatedAt) > Date.parse(version));
      assert.equal((await audits('ads.proposal_edit')).length, 1);
      // 낡은 버전으로 다시 편집 → 409 version_conflict
      const stale = await patch(id, { expected_updated_at: version, payload: p });
      assert.equal(stale.status, 409);
      assert.equal(stale.body.error.code, 'version_conflict');
      version = r.body.data.updatedAt;
      r = await decide(id, { decision: 'approve', expected_updated_at: version });
      assert.equal(r.status, 200);
      assert.equal(r.body.data.status, 'approved');
      const saved = await proposalRow(id);
      assert.equal(saved.reviewedBy, 'owner');
      assert.ok(saved.reviewedAt);
      assert.equal((await audits('ads.proposal_approve')).length, 1);
      r = await patch(id, { expected_updated_at: r.body.data.updatedAt, payload: p });
      assert.equal(r.status, 409);
      assert.equal(r.body.error.code, 'invalid_transition', '승인된 제안은 4-1에서 다시 편집할 수 없다');
      r = await decide(id, { decision: 'reject', expected_updated_at: saved.updatedAt.toISOString() });
      assert.equal(r.status, 409);
      assert.equal(r.body.error.code, 'invalid_transition');
    });

    const makeClean = async () => {
      answers.push(answer(CLEAN));
      const res = await create(input);
      assert.equal(res.status, 201);
      assert.equal(res.body.data.lintIssueCount, 0);
      return res.body.data;
    };

    await t.test('reject with reason writes audit; approve after reject is refused', async () => {
      const p = await makeClean();
      r = await decide(p.id, { decision: 'reject', expected_updated_at: p.updatedAt, reason: '키워드가 너무 넓음' });
      assert.equal(r.status, 200);
      assert.equal(r.body.data.status, 'rejected');
      const [a] = (await audits('ads.proposal_reject')).filter((x) => x.target_id === p.id);
      assert.equal(a.payload.reason, '키워드가 너무 넓음');
      assert.equal(a.actor, 'owner');
      r = await decide(p.id, { decision: 'approve', expected_updated_at: r.body.data.updatedAt });
      assert.equal(r.status, 409);
      assert.equal(r.body.error.code, 'invalid_transition');
    });

    await t.test('concurrent approve and edit conflict', async () => {
      for (const order of ['approve-first', 'edit-first']) {
        const p = await makeClean();
        const edited = answer(CLEAN);
        edited.groups[0].name = `편집됨-${order}`;
        const approve = () => decide(p.id, { decision: 'approve', expected_updated_at: p.updatedAt });
        const edit = () => patch(p.id, { expected_updated_at: p.updatedAt, payload: edited });
        const [first, second] = order === 'approve-first' ? await Promise.all([approve(), edit()]) : await Promise.all([edit(), approve()]);
        assert.deepEqual([first.status, second.status].sort(), [200, 409], order);
        const loser = [first, second].find((x) => x.status === 409);
        assert.equal(loser.body.error.code, 'version_conflict');
        assert.ok(loser.body.error.updated_at, '최신 버전을 알려 준다');
        const saved = await proposalRow(p.id);
        const editWon = [first, second].find((x) => x.status === 200).body.data.status === 'pending_review';
        if (editWon) assert.deepEqual([saved.status, saved.payload.groups[0].name], ['pending_review', `편집됨-${order}`]);
        else assert.deepEqual([saved.status, saved.payload.groups[0].name], ['approved', '전세사기 예방'], '승인 뒤 편집이 덮어쓰지 않는다(lost update 없음)');
      }
      // 두 탭이 같은 버전으로 동시에 편집 → 하나만 반영
      const p = await makeClean();
      const a = answer(CLEAN), b = answer(CLEAN);
      a.groups[0].name = 'A탭';
      b.groups[0].name = 'B탭';
      const results = await Promise.all([patch(p.id, { expected_updated_at: p.updatedAt, payload: a }), patch(p.id, { expected_updated_at: p.updatedAt, payload: b })]);
      assert.deepEqual(results.map((x) => x.status).sort(), [200, 409]);
      const winner = results.find((x) => x.status === 200).body.data.payload.groups[0].name;
      assert.equal((await proposalRow(p.id)).payload.groups[0].name, winner);
    });
  } finally {
    await env.close();
  }
});
