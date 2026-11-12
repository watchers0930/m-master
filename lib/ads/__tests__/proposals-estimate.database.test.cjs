/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process, Request */
// 제안 예상 순위(B4) — 실DB(PGlite) + 가짜 네이버: POST /api/ads/proposals/[id]/estimate(본문 없음, 같은 출처만 — GET은 없다).
// 키워드는 저장된 제안에서만(클라이언트 입력 0), 소유자 범위(IDOR 404), 원장(ad_operation_logs) 0행, 비상 정지 스위치와 무관,
// 같은 제안 60초 1회, 네이버 오류는 기존 광고 오류 매핑(naverCode 전달). 응답 어디에도 키·암호문이 없다(call 헬퍼가 검사).
// 가짜 훅은 기록·응답 교체만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupProposalsEnv, answer, CLEAN } = require('./fixtures/proposals-env.cjs');
const { request } = require('./fixtures/ads-db.cjs');
const { json } = require('./fixtures/fake-naver.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;
const PATH = '/estimate/average-position-bid/keyword';

test('proposal bid estimate on a real database', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async (t) => {
  const p0 = await setupProposalsEnv(packageDir);
  const { env, naver, answers, call, create, get, selectChannel } = p0;
  const savedSwitch = process.env.ADS_EXECUTION_ENABLED;
  try {
    const { db, session } = env;
    delete process.env.ADS_EXECUTION_ENABLED; // 스위치 꺼짐(fail-closed 기본값)에서도 조회는 된다
    const route = require('../../../app/api/ads/proposals/[id]/estimate/route.ts');
    const { resetEstimateGuard } = require('../proposal-estimate.ts');
    const ctx = (id) => ({ params: Promise.resolve({ id }) });
    const estimate = (id, qs = '') => call(() => route.POST(request('POST', `/api/ads/proposals/${id}/estimate${qs}`), ctx(id)));
    // 원시 요청(출처·본문을 직접 고른다)
    const raw = (id, headers, body) => call(() => route.POST(new Request(`http://localhost/api/ads/proposals/${id}/estimate`, { method: 'POST', headers, body }), ctx(id)));
    const estimateCalls = () => naver.state.calls.filter((c) => c.path === PATH);
    const oplogCount = async () => Number((await db.query('SELECT count(*)::int AS n FROM ad_operation_logs')).rows[0].n);

    assert.equal((await selectChannel()).status, 200);
    answers.push(answer(CLEAN));
    const created = await create(p0.input);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const proposal = created.body.data;
    const stored = proposal.payload.groups.flatMap((g) => g.keywords.map((k) => ({ keyword: k.keyword, bid: k.bidAmt })));
    assert.deepEqual(stored, [{ keyword: '전세사기', bid: 500 }, { keyword: '깡통전세', bid: 200 }, { keyword: '등기부등본', bid: 300 }]);
    naver.state.positionBids.set('전세사기', { PC: { 1: 1350, 2: 900, 3: 600, 4: 450, 5: 300 }, MOBILE: { 1: 1200, 2: 800, 3: 500, 4: 400, 5: 250 } });
    naver.state.positionBids.set('등기부등본', { PC: { 1: 700, 2: 500, 3: 400, 4: 350, 5: 310 }, MOBILE: { 2: 290, 5: 100 } });

    await t.test('(e)(f) stored keywords only, expected positions, no oplog row, switch off', async () => {
      const before = await oplogCount();
      const r = await estimate(proposal.id);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const d = r.body.data;
      assert.deepEqual(d.devices, ['PC', 'MOBILE']);
      assert.ok(!Number.isNaN(Date.parse(d.fetchedAt)));
      assert.deepEqual(d.bidRange, (await get(proposal.id)).body.data.bidRange);
      assert.deepEqual(d.rows, [
        { keyword: '전세사기', bid: 500, PC: { 1: 1350, 2: 900, 3: 600, 4: 450, 5: 300 }, MOBILE: { 1: 1200, 2: 800, 3: 500, 4: 400, 5: 250 }, expected: { PC: 4, MOBILE: 3 } },
        { keyword: '깡통전세', bid: 200, PC: {}, MOBILE: {}, expected: { PC: null, MOBILE: null } },
        { keyword: '등기부등본', bid: 300, PC: { 1: 700, 2: 500, 3: 400, 4: 350, 5: 310 }, MOBILE: { 2: 290, 5: 100 }, expected: { PC: '6위 이하', MOBILE: 2 } },
      ]);
      const sent = estimateCalls();
      assert.deepEqual(sent.map((c) => [c.method, c.body.device]), [['POST', 'PC'], ['POST', 'MOBILE']]);
      for (const c of sent) assert.deepEqual([...new Set(c.body.items.map((i) => i.key))], ['전세사기', '깡통전세', '등기부등본']);
      assert.equal(await oplogCount(), before, '조회는 원장에 쓰지 않는다');
      assert.equal(process.env.ADS_EXECUTION_ENABLED, undefined);
    });

    await t.test('same proposal again within 60s is refused without calling Naver', async () => {
      const n = estimateCalls().length;
      const r = await estimate(proposal.id);
      assert.equal(r.status, 429);
      assert.equal(r.body.error.code, 'ads_estimate_cooldown');
      assert.ok(r.body.error.retryAfterSec >= 1 && r.body.error.retryAfterSec <= 60);
      assert.equal(estimateCalls().length, n);
      resetEstimateGuard();
      process.env.ADS_EXECUTION_ENABLED = 'false';
      assert.equal((await estimate(proposal.id)).status, 200, '스위치 값과 무관');
      delete process.env.ADS_EXECUTION_ENABLED;
    });

    await t.test('(e) no client keyword input: any query parameter is a 400 and nothing is sent', async () => {
      resetEstimateGuard();
      const n = estimateCalls().length;
      for (const qs of ['?keywords=%EB%8C%80%EC%B6%9C', '?keyword=x&device=BOTH', '?']) {
        const r = await estimate(proposal.id, qs);
        if (qs === '?') { assert.equal(r.status, 200, 'empty query string carries no input'); resetEstimateGuard(); continue; }
        assert.equal(r.status, 400, qs);
      }
      assert.equal(estimateCalls().length, n + 2, '빈 ? 만 조회했다(PC·MOBILE 2회)');
    });

    await t.test('POST only: same-origin proof required, no body accepted, no GET handler', async () => {
      resetEstimateGuard();
      const n = estimateCalls().length;
      assert.equal(typeof route.GET, 'undefined', 'GET 없음 → Next가 405');
      assert.deepEqual(Object.keys(route).filter((k) => /^[A-Z]+$/.test(k)).sort(), ['POST']);
      for (const headers of [
        { origin: 'https://evil.example' },
        { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
        { 'sec-fetch-site': 'cross-site' },
        {}, // 출처 증명 없음
      ]) assert.equal((await raw(proposal.id, headers)).status, 403, JSON.stringify(headers));
      for (const body of ['{}', '{"keywords":["대출"]}', 'x', ' ']) {
        const r = await raw(proposal.id, { origin: 'http://localhost', 'content-type': 'application/json' }, body);
        assert.equal(r.status, 400, JSON.stringify(body));
      }
      assert.equal(estimateCalls().length, n, '거부된 요청은 네이버에 닿지 않고 1분 제한도 잡지 않는다');
      assert.equal((await raw(proposal.id, { origin: 'http://localhost' })).status, 200);
      // Origin 없이 same-origin fetch도 출처 증명으로 통과한다(→ 1분 제한까지 도달 = 429)
      assert.equal((await raw(proposal.id, { 'sec-fetch-site': 'same-origin' })).status, 429);
    });

    await t.test('(e) ownership: another user, an outsider, a bad id and no session never reach Naver', async () => {
      resetEstimateGuard();
      const n = estimateCalls().length;
      try {
        session.user = 'other';
        assert.equal((await estimate(proposal.id)).status, 404);
        session.user = 'outsider';
        assert.equal((await estimate(proposal.id)).status, 404);
        session.user = 'owner';
        assert.equal((await estimate('not a valid id!')).status, 404);
        assert.equal((await estimate('ckproposal0000000000000099')).status, 404);
        session.user = null;
        assert.equal((await estimate(proposal.id)).status, 401);
      } finally {
        session.user = 'owner';
      }
      // 제안 행 자체의 소유자 범위(계정 범위와 별개): 내 제안 행이 남의 계정을 가리키는 비정상 행도 남에게는 404다
      const theirs = await env.client.adAccount.create({ data: { ownerId: 'other', naverCustomerId: '998', label: 'x', status: 'active' } });
      const crafted = await env.client.adProposal.create({ data: { ownerId: 'owner', adAccountId: theirs.id, kind: 'new_campaign', status: 'pending_review', payload: proposal.payload } });
      try {
        session.user = 'other';
        assert.equal((await estimate(crafted.id)).status, 404);
      } finally {
        session.user = 'owner';
      }
      assert.equal(estimateCalls().length, n);
      assert.equal((await estimate(proposal.id)).status, 200, '남의 시도가 내 1분 제한을 잡지 않는다');
    });

    await t.test('Naver errors use the ads error mapping with naverCode, never a 500', async () => {
      try {
        resetEstimateGuard();
        naver.state.hooks.before = (c) => (c.path === PATH ? json(403, { code: 1018, title: 'forbidden' }) : undefined);
        let r = await estimate(proposal.id);
        assert.deepEqual([r.status, r.body.error.code, r.body.error.naverCode], [409, 'ads_forbidden', 1018]);
        resetEstimateGuard();
        naver.state.hooks.before = (c) => (c.path === PATH ? json(500, { code: 1016 }) : undefined);
        r = await estimate(proposal.id);
        assert.deepEqual([r.status, r.body.error.code], [503, 'ads_unavailable']);
        resetEstimateGuard();
        naver.state.hooks.before = (c) => (c.path === PATH ? json(200, { nope: true }) : undefined);
        r = await estimate(proposal.id);
        assert.deepEqual([r.status, r.body.error.code], [502, 'ads_unexpected_response']);
      } finally {
        naver.state.hooks.before = undefined;
      }
      assert.equal(await oplogCount(), 0);
    });
  } finally {
    if (savedSwitch === undefined) delete process.env.ADS_EXECUTION_ENABLED;
    else process.env.ADS_EXECUTION_ENABLED = savedSwitch;
    await env.close();
  }
});
