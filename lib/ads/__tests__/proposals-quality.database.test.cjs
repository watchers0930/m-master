/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// AI 광고 제안 품질(2026-11-11 실운영 제안이 'AI 및 데이터 분석'으로 빗나간 사고) — 실DB(PGlite) + 가짜 네이버 + 가짜 LLM:
// (a) 수동 씨앗 + 도메인 → 리서치 힌트는 수동 씨앗만, (b) 수동 씨앗과 무관한 결과(AI·AI교육)는 근거 집합에서 빠진다,
// (d) 승인은 하루 상한 기준 입찰 천장(1만 원 → 1000원)을 다시 검사한다(편집도 같은 규칙), (e) 수동 씨앗이 없으면 이전 동작(도메인 풀·필터 없음).
// 가짜 훅은 기록만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupProposalsEnv, answer, kw, CLEAN } = require('./fixtures/proposals-env.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;

const row = (relKeyword, pc, mobile, compIdx = '중간') => ({ relKeyword, monthlyPcQcCnt: pc, monthlyMobileQcCnt: mobile, monthlyAvePcCtr: 0.5, monthlyAveMobileCtr: 1.2, plAvgDepth: 15, compIdx });

test('ads proposal quality on a real database', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async (t) => {
  const p0 = await setupProposalsEnv(packageDir);
  const { env, naver, llmCalls, answers, input, create, get, patch, decide, proposalRow, selectChannel } = p0;
  try {
    const { db, client } = env;
    assert.equal((await selectChannel()).status, 200);
    naver.state.keywordRows.push(row('AI', 90000, 90000, '높음'), row('AI교육', 50000, 50000), row('전세사기 예방법', 10, 20, '낮음'));
    const domain = await client.domain.create({ data: { ownerId: 'owner', url: 'vestra.ai.kr' } });
    let n = 0;
    for (const [keyword, searchVolume] of [['AI', 99999], ['인공지능', 5000]])
      await client.seoKeyword.create({ data: { domainId: domain.id, keyword, normalizedKeyword: `${keyword}-${++n}`, engine: 'google', searchVolume } });
    const hints = () => naver.state.calls.filter((c) => c.method === 'GET' && c.path === '/keywordstool').map((c) => c.query.hintKeywords);
    const promptData = (call) => JSON.parse(call.messages[1].content);
    const onTopic = () => ({ groups: [
      { name: '전세사기 예방', bidAmt: 300, keywords: [kw('전세사기'), kw('깡통전세', 200)], creatives: CLEAN },
      { name: '예방법 안내', bidAmt: 300, keywords: [kw('전세사기 예방법', 300)], creatives: CLEAN },
    ] });
    let r;

    await t.test('(a)+(b) manual seeds with a domain: research uses manual seeds only; off-topic results never reach the LLM', async () => {
      naver.state.calls.length = 0;
      llmCalls.length = 0;
      answers.push(onTopic());
      r = await create({ ...input, domainId: domain.id, seeds: ['전세사기', '전세 보증금'] });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.deepEqual(hints(), ['전세사기,전세보증금'], 'SEO 씨앗(AI·인공지능)은 힌트에 섞이지 않는다');
      const source = r.body.data.sourceKeywords.map((k) => k.keyword);
      assert.deepEqual(source, ['전세사기', '전세사기 예방법', '깡통전세'], '등기부등본·AI·AI교육은 수동 씨앗과 무관해 빠진다');
      const data = promptData(llmCalls[0]);
      assert.equal(data.seedSource, 'manual');
      assert.deepEqual(data.untrustedKeywordData.seeds, ['전세사기', '전세보증금']);
      assert.deepEqual(data.untrustedKeywordData.keywords.map((k) => k.keyword), source);
      assert.equal(data.bidRange.max, 1000, '하루 상한 1만 원 → 천장 1000원(maxBid 2000보다 낮다)');
      assert.deepEqual(r.body.data.bidRange, { min: 70, max: 1000 }, 'B1: 화면이 쓸 입찰 범위는 서버가 같은 천장 함수로 보낸다');
    });

    await t.test('(e) no manual seeds: domain pool seeds, no relevance filter (previous behaviour)', async () => {
      naver.state.calls.length = 0;
      llmCalls.length = 0;
      answers.push(answer(CLEAN));
      r = await create({ ...input, domainId: domain.id, seeds: [] });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.deepEqual(hints(), ['AI,인공지능']);
      assert.deepEqual(r.body.data.sourceKeywords.map((k) => k.keyword).sort(), ['AI', 'AI교육', '깡통전세', '등기부등본', '전세사기', '전세사기 예방법'].sort());
      assert.equal(promptData(llmCalls[0]).seedSource, 'domain');
    });

    await t.test('(d) approve rejects a stored bid above the ceiling; edit uses the same rule; 1000 itself is approvable', async () => {
      answers.push(answer(CLEAN));
      const p = (await create(input)).body.data;
      const stored = (await proposalRow(p.id)).payload;
      stored.groups[0].bidAmt = 1200; // 기존 실운영 제안(입찰 1200~1500)과 같은 상황 — maxBid 2000 안이지만 천장 1000 위
      await db.query('UPDATE ad_proposals SET payload = $1::jsonb WHERE id = $2', [JSON.stringify(stored), p.id]);
      const version = (await proposalRow(p.id)).updatedAt.toISOString();
      r = await decide(p.id, { decision: 'approve', expected_updated_at: version });
      assert.deepEqual([r.status, r.body.error?.code, r.body.error?.field], [422, 'ads_invariant', 'groups.0.bidAmt']);
      assert.ok(r.body.error.message.includes('70~1,000원'), `B1: 승인 거절 메시지에 범위 숫자: ${r.body.error.message}`);
      assert.equal((await proposalRow(p.id)).status, 'pending_review');
      const edit = answer(CLEAN);
      edit.groups[1].keywords[0].bidAmt = 1001;
      r = await patch(p.id, { expected_updated_at: version, payload: edit });
      assert.deepEqual([r.status, r.body.error?.code, r.body.error?.field], [422, 'ads_invariant', 'groups.1.keywords.0.bidAmt']);
      assert.ok(r.body.error.message.includes('입찰가는 70~1,000원'), `B1: 편집 거절 메시지에 범위 숫자: ${r.body.error.message}`);
      edit.groups[1].keywords[0].bidAmt = 1000;
      edit.groups[0].bidAmt = 1000;
      r = await patch(p.id, { expected_updated_at: version, payload: edit });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.deepEqual(r.body.data.bidRange, { min: 70, max: 1000 }, 'B1: 편집 응답 DTO 도 입찰 범위를 싣는다');
      r = await decide(p.id, { decision: 'approve', expected_updated_at: r.body.data.updatedAt });
      assert.equal(r.status, 200, '천장 값 1000은 승인된다(양성 대조)');
      assert.deepEqual(r.body.data.bidRange, { min: 70, max: 1000 }, 'B1: 승인 응답 DTO 도 입찰 범위를 싣는다');
      r = await get(p.id);
      assert.equal(r.status, 200);
      assert.deepEqual(r.body.data.bidRange, { min: 70, max: 1000 }, 'B1: 상세 GET 도 입찰 범위를 싣는다');
      answers.push(answer(CLEAN));
      const toReject = (await create(input)).body.data;
      r = await decide(toReject.id, { decision: 'reject', expected_updated_at: toReject.updatedAt });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.deepEqual(r.body.data.bidRange, { min: 70, max: 1000 }, 'B1: 반려 응답 DTO 도 입찰 범위를 싣는다');
    });
  } finally {
    await env.close();
  }
});
