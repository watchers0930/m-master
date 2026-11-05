/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, Response, setTimeout */
// 블로그 작업자 claim-v1 흐름 단위 테스트 (네이버·서버 실호출 없음, Playwright 미사용)
require('../../../lib/visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runClaimedItem } = require('../flow.ts');
const { createWorkerApi, WorkerApiError } = require('../api-client.ts');
const { classifyLoginUrl } = require('../login.ts');

const TOKEN = 't'.repeat(43);
const item = { id: 'c1', ownerId: 'u1', topic: '주제', textBody: '본문', imageUrl: null, bodyImageUrls: [], keywords: [],
  claim: { token: TOKEN, contentVersion: '2026-11-04T00:00:00.000Z', expiresAt: '2026-11-04T01:00:00.000Z' } };

function fakeApi(over = {}) {
  const calls = [];
  const api = {
    calls,
    pending: async () => ({ items: [item], date: '2026-11-04', skipped: false, reason: null }),
    verify: async it => { calls.push(['verify', it.claim.token]); return { ok: true, expiresAt: 'x' }; },
    complete: async (it, url) => { calls.push(['complete', it.claim.token, url]); return { ok: true }; },
    fail: async (it, outcome, reason) => { calls.push(['fail', outcome, reason]); },
    ...over,
  };
  return api;
}
/** publishOne과 같은 계약의 가짜 게시: 발행 직전 hooks.beforePublish 호출, 예외는 결과로 변환 */
function fakePublish(opts = {}) {
  const state = { posted: 0, started: 0 };
  const publish = async (_it, hooks, progress) => {
    state.started++;
    try {
      if (opts.slowMs) await new Promise(r => setTimeout(r, opts.slowMs));
      await hooks.beforePublish();
      if (progress.cancelled) throw new Error('cancelled');
      progress.publishClicked = true;
      if (opts.throwAfterClick) throw new Error('발행 다이얼로그 오류');
      state.posted++;
      return { success: true, url: 'https://blog.naver.com/vestra/224000000001' };
    } catch (err) {
      return { success: false, error: String(err), cause: err, publishClicked: progress.publishClicked };
    }
  };
  return { publish, state };
}
const deps = (api, publish, extra = {}) => ({ api, publish, dryRun: false, deadlineMs: 5000, retryDelayMs: 1, ...extra });

test('사전 verify 409 → 게시 시작조차 하지 않고 fail(not_posted)', async () => {
  const api = fakeApi({ verify: async () => { throw new WorkerApiError(409, 'not_publishable'); } });
  const { publish, state } = fakePublish();
  const result = await runClaimedItem(item, deps(api, publish));
  assert.deepEqual(result, { status: 'not_posted', reason: 'not_publishable' });
  assert.equal(state.started, 0);
  assert.equal(api.calls.some(c => c[0] === 'complete'), false);
  assert.deepEqual(api.calls.at(-1), ['fail', 'not_posted', 'not_publishable']);
});

test('claim 후 검토 철회(발행 직전 verify 409) → 게시 안 함, complete 없음', async () => {
  let n = 0;
  const api = fakeApi({ verify: async () => { if (++n === 2) throw new WorkerApiError(409, 'not_publishable'); return { ok: true }; } });
  const { publish, state } = fakePublish();
  const result = await runClaimedItem(item, deps(api, publish));
  assert.equal(result.status, 'not_posted');
  assert.equal(state.started, 1);
  assert.equal(state.posted, 0);
  assert.equal(api.calls.some(c => c[0] === 'complete'), false);
  assert.deepEqual(api.calls.at(-1), ['fail', 'not_posted', 'not_publishable']);
});

test('정상 게시 → complete(claimToken + 네이버 URL), 일시 오류는 같은 토큰으로 재시도', async () => {
  let attempts = 0;
  const api = fakeApi({ complete: async (it, url) => {
    attempts++; api.calls.push(['complete', it.claim.token, url]);
    if (attempts === 1) throw new WorkerApiError(503, 'internal_error');
    return { ok: true };
  } });
  const { publish } = fakePublish();
  const result = await runClaimedItem(item, deps(api, publish));
  assert.equal(result.status, 'published');
  const completes = api.calls.filter(c => c[0] === 'complete');
  assert.equal(completes.length, 2);
  assert.ok(completes.every(c => c[1] === TOKEN && c[2].startsWith('https://blog.naver.com/')));
  assert.equal(api.calls.some(c => c[0] === 'fail'), false);
});

test('complete가 409로 거절되면(위조·만료 토큰) 재시도 없이 unknown 보고, 게시 URL은 결과에 남김', async () => {
  const api = fakeApi({ complete: async () => { api.calls.push(['complete']); throw new WorkerApiError(409, 'claim_invalid'); } });
  const { publish } = fakePublish();
  const result = await runClaimedItem(item, deps(api, publish));
  assert.equal(result.status, 'unknown');
  assert.equal(result.url, 'https://blog.naver.com/vestra/224000000001');
  assert.equal(api.calls.filter(c => c[0] === 'complete').length, 1);
  assert.deepEqual(api.calls.at(-1), ['fail', 'unknown', 'publish_error']);
});

test('최종 발행 클릭 이후 오류 → unknown(자동 재게시 금지)', async () => {
  const api = fakeApi();
  const { publish } = fakePublish({ throwAfterClick: true });
  const result = await runClaimedItem(item, deps(api, publish));
  assert.deepEqual(result, { status: 'unknown', reason: 'publish_error', url: undefined });
});

test('시간 초과 → not_posted 보고 후 늦게 도착한 최종 클릭은 차단', async () => {
  const api = fakeApi();
  const { publish, state } = fakePublish({ slowMs: 60 });
  const result = await runClaimedItem(item, deps(api, publish, { deadlineMs: 10 }));
  assert.deepEqual(result, { status: 'not_posted', reason: 'timeout' });
  await new Promise(r => setTimeout(r, 120));
  assert.equal(state.posted, 0);
});

test('dry-run → 게시·complete 없이 claim 반납(fail not_posted dry_run)', async () => {
  const api = fakeApi();
  const { publish } = fakePublish();
  const result = await runClaimedItem(item, deps(api, publish, { dryRun: true }));
  assert.equal(result.status, 'dry_run');
  assert.equal(api.calls.some(c => c[0] === 'complete'), false);
  assert.deepEqual(api.calls.at(-1), ['fail', 'not_posted', 'dry_run']);
});

test('API 클라이언트: 4개 호출 모두 인증·프로토콜·소유자 헤더, fail 본문은 사유 코드만', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    if (url.endsWith('/pending')) return new Response(JSON.stringify({ items: [item, { ...item, id: 'noclaim', claim: undefined }], date: 'd', skipped: false, reason: null }));
    if (url.endsWith('/verify')) return new Response(JSON.stringify({ error: { code: 'claim_expired' } }), { status: 409 });
    return new Response(JSON.stringify({ ok: true }));
  };
  const api = createWorkerApi({ appUrl: 'https://app.test', apiKey: 'k'.repeat(40), ownerId: 'u1', fetchImpl });
  const pending = await api.pending();
  assert.deepEqual(pending.items.map(i => i.id), ['c1']); // claim 없는 항목은 버림
  await assert.rejects(api.verify(item), e => e instanceof WorkerApiError && e.status === 409 && e.code === 'claim_expired');
  await api.complete(item, 'https://blog.naver.com/a/1');
  await api.fail(item, 'not_posted', 'session_expired');
  assert.equal(seen.length, 4);
  for (const { init } of seen) {
    assert.equal(init.headers['x-api-key'], 'k'.repeat(40));
    assert.equal(init.headers['x-blog-worker-protocol'], 'claim-v1');
    assert.equal(init.headers['x-blog-worker-owner'], 'u1');
  }
  assert.deepEqual(JSON.parse(seen[3].init.body), { contentId: 'c1', claimToken: TOKEN, outcome: 'not_posted', error: 'session_expired' });
  assert.deepEqual(Object.keys(JSON.parse(seen[2].init.body)).sort(), ['claimToken', 'contentId', 'externalUrl']);
});

test('로그인 차단 URL 판별: 캡차·2단계 인증·로그인 실패', () => {
  assert.deepEqual(classifyLoginUrl('https://nid.naver.com/nidlogin.login?mode=captcha'), { ok: false, reason: 'captcha_required' });
  assert.deepEqual(classifyLoginUrl('https://nid.naver.com/login/ext/deviceConfirm'), { ok: false, reason: 'two_factor_required' });
  assert.deepEqual(classifyLoginUrl('https://nid.naver.com/nidlogin.login'), { ok: false, reason: 'login_failed' });
  assert.deepEqual(classifyLoginUrl('https://www.naver.com/'), { ok: true });
});
