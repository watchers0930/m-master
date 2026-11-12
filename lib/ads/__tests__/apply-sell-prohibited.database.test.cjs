/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 판매 금지 키워드(실운영 2026-11-12) — 실DB(PGlite) + 가짜 네이버. 네이버는 판매 금지 키워드 생성 POST에 성공 코드(201 본문 없음 또는 200 빈 배열)로
// 답하고 등록하지 않는다 → 앱은 '불확실'로 멈추고 재개해도 목록에 없어 영구히 멈췄다. 적용은 키워드 단계 전에 GET /ncc/managedKeyword로
// 판매 금지를 조회해, 원장을 보기 전에 건너뛰고(만들어진 적 있으면 이어 쓴다) 감사 로그·결과에 남긴다. 조회 실패면 키워드 POST 0으로 멈춘다.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupApplyEnv } = require('./fixtures/apply-env.cjs');
const { answer, CLEAN } = require('./fixtures/proposals-env.cjs');
const { json } = require('./fixtures/fake-naver.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;
const KW = /^\/ncc\/keywords$/;

test('sell-prohibited keywords are skipped on apply', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async (t) => {
  const a = await setupApplyEnv(packageDir);
  const { env, naver, approved, apply, posts, mirrors, resetFaults, get, create, input, answers, llmCalls } = a;
  const { client } = env;
  const prohibitedPosts = () => naver.state.calls.filter((c) => c.method === 'POST' && KW.test(c.path) && c.body.some((k) => k.keyword === '등기부등본')).length;
  try {
    for (const mode of ['created', 'empty']) {
      await t.test(`fresh apply: prohibited keyword is never sent, the rest completes (${mode})`, async () => {
        naver.state.sellProhibited = new Set(['등기부등본']);
        naver.state.prohibitedCreate = mode;
        const before = prohibitedPosts();
        const p = await approved();
        const r = await apply(p.id);
        assert.deepEqual(r.body.data, { status: 'applied', skippedKeywords: ['등기부등본'] }, JSON.stringify(r.body));
        assert.equal(prohibitedPosts(), before, '판매 금지 키워드 POST 0');
        const m = await mirrors(p.id);
        assert.deepEqual([m.groups.length, m.keywords.map((k) => k.keyword), m.creatives.length], [2, ['깡통전세', '전세사기'], 4]);
        const audit = await client.auditLog.findFirst({ where: { targetId: p.id, action: 'ads.proposal_apply' }, orderBy: { createdAt: 'desc' } });
        assert.deepEqual(audit.payload, { status: 'applied', failCode: null, skippedKeywords: ['등기부등본'] });
        const d = await get(p.id);
        assert.deepEqual(d.body.data.skippedKeywords, ['등기부등본'], '상세 응답에도 남는다');
      });
    }

    await t.test('운영 상태 재현: 조회 없이 보낸 판매 금지 POST가 불확실로 멈춤 → 재개는 건너뛰고 끝까지(재전송 0)', async () => {
      naver.state.sellProhibited = new Set(['등기부등본']);
      naver.state.prohibitedCreate = 'created';
      const p = await approved();
      // 첫 시도: 판매 금지 조회가 '아님'으로 답한 상황(구 버전처럼 그대로 보냄) → 201 본문 없음 → uncertain
      naver.state.hooks.before = (c) => (c.method === 'GET' && c.path === '/ncc/managedKeyword'
        ? json(200, String(c.query.keywords).split(',').map((keyword) => ({ keyword, managedKeyword: { keyword, isSellProhibit: false } }))) : undefined);
      try {
        const r = await apply(p.id);
        assert.equal(r.body.data.status, 'apply_failed');
        assert.match(r.body.data.failCode, /^uncertain:keyword:g2:k0$/);
      } finally { resetFaults(); }
      const sent = prohibitedPosts();
      const r = await apply(p.id);
      assert.deepEqual(r.body.data, { status: 'applied', skippedKeywords: ['등기부등본'] }, JSON.stringify(r.body));
      assert.equal(prohibitedPosts(), sent, '재개는 판매 금지 키워드를 다시 보내지 않는다');
      const m = await mirrors(p.id);
      assert.deepEqual([m.keywords.length, m.creatives.length], [2, 4]);
    });

    await t.test('이미 만들어진 키워드가 나중에 판매 금지가 되면 건너뛰지 않고 이어 쓴다(고아 방지)', async () => {
      naver.state.sellProhibited = new Set();
      const p = await approved();
      let n = 0; // 키워드 2번째 POST 직후 실패시켜 재개를 만든다(첫 키워드는 만들어진 상태)
      naver.state.hooks.before = (c) => (c.method === 'POST' && KW.test(c.path) && ++n === 2 ? json(400, { code: 3909, title: 'forbidden' }) : undefined);
      try { assert.equal((await apply(p.id)).body.data.status, 'apply_failed'); } finally { resetFaults(); }
      naver.state.sellProhibited = new Set(['전세사기']); // 이미 만들어진 첫 키워드
      const r = await apply(p.id);
      assert.deepEqual(r.body.data, { status: 'applied' }, JSON.stringify(r.body));
      const m = await mirrors(p.id);
      assert.ok(m.keywords.some((k) => k.keyword === '전세사기'), '이미 만들어진 키워드는 미러로 남는다');
    });

    await t.test('판매 금지 조회 실패 → 키워드 POST 0, apply_failed, 재시도하면 끝까지', async () => {
      naver.state.sellProhibited = new Set(['등기부등본']);
      const p = await approved();
      const k0 = posts(KW);
      naver.state.hooks.before = (c) => (c.method === 'GET' && c.path === '/ncc/managedKeyword' ? json(500, { code: 9999, title: 'down' }) : undefined);
      try {
        const r = await apply(p.id);
        assert.equal(r.body.data.status, 'apply_failed', JSON.stringify(r.body));
      } finally { resetFaults(); }
      assert.equal(posts(KW), k0, '조회 실패 시 키워드는 하나도 보내지 않는다');
      const r = await apply(p.id);
      assert.deepEqual(r.body.data, { status: 'applied', skippedKeywords: ['등기부등본'] });
    });
    await t.test('제안 생성: 판매 금지 키워드는 AI에 넘기지 않고 근거(sourceKeywords)에도 없다', async () => {
      naver.state.sellProhibited = new Set(['등기부등본']);
      const g = answer(CLEAN).groups[0];
      const one = { groups: [{ ...g, keywords: [g.keywords[0]] }, { ...g, name: '깡통전세 확인', keywords: [g.keywords[1]] }] }; // 판매 금지 아닌 키워드만
      answers.push(one, one); // 첫 답 + 교정 1회(propose.ts MAX_REPAIR_CALLS) — 이 테스트는 AI에 넘긴 키워드만 본다
      const before = llmCalls.length;
      const r = await create(input);
      assert.equal(r.status, 201, JSON.stringify(r.body));
      answers.length = 0;
      assert.ok(!r.body.data.sourceKeywords.some((s) => s.keyword === '등기부등본'), '근거에서 빠진다');
      assert.ok(llmCalls.length > before, 'AI는 불렸다(씨앗 주제는 프롬프트에 남는다 — 거르는 것은 키워드 후보 목록)');
      assert.ok(!r.body.data.payload.groups.some((g) => g.keywords.some((k) => k.keyword === '등기부등본')), '제안 키워드에 없다');
      assert.equal(naver.count('GET', /^\/ncc\/managedKeyword$/) > 0, true);
    });

    await t.test('제안 생성: 판매 금지 조회가 실패해도 생성은 진행(적용 단계가 다시 막는다)', async () => {
      naver.state.sellProhibited = new Set(['등기부등본']);
      answers.push(answer(CLEAN));
      naver.state.hooks.before = (c) => (c.method === 'GET' && c.path === '/ncc/managedKeyword' ? json(500, { code: 9999, title: 'down' }) : undefined);
      try {
        const r = await create(input);
        assert.equal(r.status, 201, JSON.stringify(r.body));
        assert.ok(r.body.data.sourceKeywords.some((s) => s.keyword === '등기부등본'), '조회 실패면 거르지 않는다');
      } finally { resetFaults(); }
    });
  } finally {
    naver.state.sellProhibited = new Set();
    await env.close();
  }
});
