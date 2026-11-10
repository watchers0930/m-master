/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// AI 광고 제안 접근 — 실DB(PGlite): 남의 제안·계정·광고그룹 id는 404(IDOR), 허용목록 밖 404, 목록은 소유자 범위 키셋 페이지(take 상한),
// 응답·행 어디에도 계정 키·암호문이 없다. 가짜 훅은 기록만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupProposalsEnv, answer, CLEAN, KEY, SECRET_KEY } = require('./fixtures/proposals-env.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;

test('ads proposal access and listing on a real database', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async (t) => {
  const p0 = await setupProposalsEnv(packageDir);
  const { env, llmCalls, answers, accountId, input, create, get, patch, decide, listGet, proposalRow, blobs, selectChannel } = p0;
  try {
    const { db, client, session } = env;
    let r;
    assert.equal((await selectChannel()).status, 200);
    const makeClean = async () => {
      answers.push(answer(CLEAN));
      const res = await create(input);
      assert.equal(res.status, 201);
      assert.equal(res.body.data.lintIssueCount, 0);
      return res.body.data;
    };
    for (let i = 0; i < 4; i++) await makeClean();
    const toReject = await makeClean();
    assert.equal((await decide(toReject.id, { decision: 'reject', expected_updated_at: toReject.updatedAt })).status, 200);

    await t.test('IDOR 404', async () => {
      const mine = await makeClean();
      session.user = 'other';
      try {
        for (const res of [
          await get(mine.id),
          await patch(mine.id, { expected_updated_at: mine.updatedAt, payload: answer(CLEAN) }),
          await decide(mine.id, { decision: 'approve', expected_updated_at: mine.updatedAt }),
          await create(input), // 남의 계정 id로 생성
        ]) assert.equal(res.status, 404);
        assert.deepEqual((await listGet()).body.data.items, []);
        assert.deepEqual((await listGet(`?accountId=${accountId}`)).body.data.items, []);
        session.user = 'outsider'; // 허용목록 밖
        assert.equal((await get(mine.id)).status, 404);
        assert.equal((await listGet()).status, 404);
      } finally {
        session.user = 'owner';
      }
      assert.equal((await proposalRow(mine.id)).status, 'pending_review');
      assert.equal((await get('not a valid id!')).status, 404);
      // extend_group: 대상 광고그룹은 이 계정·소유자 것이어야 한다
      await db.exec(`INSERT INTO ad_groups(id, owner_id, ad_account_id, naver_id, name, updated_at) VALUES ('g-mine','owner','${accountId}','grp-a001-01-000000000001','mq-x-g1',now())`);
      const foreign = await client.adAccount.create({ data: { ownerId: 'other', naverCustomerId: '999', label: 'x', status: 'disabled' } });
      await db.exec(`INSERT INTO ad_groups(id, owner_id, ad_account_id, naver_id, name, updated_at) VALUES ('g-theirs','other','${foreign.id}','grp-a001-01-000000000009','mq-y-g1',now())`);
      const before = llmCalls.length;
      r = await create({ accountId, kind: 'extend_group', targetAdgroupId: 'grp-a001-01-000000000009', seeds: ['전세사기'] });
      assert.equal(r.status, 404);
      assert.equal(llmCalls.length, before);
      answers.push({ groups: [answer(CLEAN).groups[0]] });
      r = await create({ accountId, kind: 'extend_group', targetAdgroupId: 'grp-a001-01-000000000001', seeds: ['전세사기'] });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.deepEqual([r.body.data.kind, r.body.data.targetAdgroupId, r.body.data.payload.groups.length], ['extend_group', 'grp-a001-01-000000000001', 1]);
    });

    await t.test('list is owner-scoped and paginated by cursor with a take bound', async () => {
      const total = await client.adProposal.count({ where: { ownerId: 'owner' } });
      assert.ok(total >= 5);
      const seen = [];
      let cursor = null;
      do {
        r = await listGet(`?take=2${cursor ? `&cursor=${cursor}` : ''}`);
        assert.equal(r.status, 200);
        assert.ok(r.body.data.items.length <= 2);
        seen.push(...r.body.data.items.map((x) => x.id));
        cursor = r.body.data.nextCursor;
      } while (cursor);
      assert.equal(seen.length, total);
      assert.equal(new Set(seen).size, total);
      assert.equal('payload' in (await listGet()).body.data.items[0], false, '목록은 요약만');
      assert.equal((await listGet('?take=51')).status, 400);
      const approved = await client.adProposal.count({ where: { ownerId: 'owner', status: 'rejected' } });
      assert.ok(approved >= 1);
      const filtered = (await listGet('?status=rejected&take=50')).body.data.items;
      assert.equal(filtered.length, approved);
      assert.ok(filtered.every((x) => x.status === 'rejected'));
      assert.equal((await listGet('?bogus=1')).status, 400);
      // 남의 제안 id를 커서로 쓰면 400(그 행의 정렬 위치를 기준으로 쓰지 않는다)
      const foreignAccount = await client.adAccount.findFirstOrThrow({ where: { ownerId: 'other' } });
      const theirs = await client.adProposal.create({ data: { ownerId: 'other', adAccountId: foreignAccount.id, kind: 'new_campaign', status: 'pending_review', payload: { groups: [] } } });
      r = await listGet(`?cursor=${theirs.id}`);
      assert.deepEqual([r.status, r.body.error.code], [400, 'bad_cursor']);
      assert.equal((await get(theirs.id)).status, 404);
    });

    await t.test('no proposal response or row contains account secrets', async () => {
      const text = JSON.stringify(await client.adProposal.findMany());
      for (const needle of [KEY, SECRET_KEY, ...(await blobs())]) assert.equal(text.includes(needle), false);
    });
  } finally {
    await env.close();
  }
});
