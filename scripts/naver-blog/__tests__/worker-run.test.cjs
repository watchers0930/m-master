/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, setTimeout */
// 작업자 실제 배선(worker-run.ts: main.ts가 쓰는 그대로) 회귀 테스트 — Playwright·네이버·서버 실호출 없음.
// 핵심: flow가 만든 progress 하나가 publishOne·시간초과 판정·abort에 그대로 흘러야 한다.
require('../../../lib/visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWorkerRun, exitCodeOf } = require('../worker-run.ts');
const { PublishCancelled } = require('../publish.ts');

const TOKEN = 't'.repeat(43);
const item = (over = {}) => ({ id: 'c1', ownerId: 'u1', topic: '주제', textBody: '본문', imageUrl: null, bodyImageUrls: [], keywords: [],
  claim: { token: TOKEN, contentVersion: null, expiresAt: 'x' }, ...over });
const sleep = ms => new Promise(r => setTimeout(r, ms));

function fakeApi(pendingItem = item()) {
  const calls = [];
  return { calls,
    pending: async () => ({ items: pendingItem ? [pendingItem] : [], date: 'd', skipped: false, reason: pendingItem ? null : 'no_eligible_content' }),
    verify: async () => { calls.push(['verify']); return { ok: true, expiresAt: 'x' }; },
    complete: async (_it, url) => { calls.push(['complete', url]); return { ok: true }; },
    fail: async (_it, outcome, reason) => { calls.push(['fail', outcome, reason]); },
  };
}
/**
 * publishOne과 같은 시그니처·같은 진행 표시 규칙(publish.ts clickPublish)을 따르는 가짜:
 * beforePublish → 첫 클릭 → [cancelled면 PublishCancelled] → publishClicked=true → 최종 클릭 → (지연) → 결과
 */
function fakePublishOne(opts) {
  const state = { finalClicks: 0, pages: [] };
  const publishOne = async (page, _item, hooks, progress) => {
    state.pages.push(page);
    try {
      if (opts.beforeClickMs) await sleep(opts.beforeClickMs);
      await hooks.beforePublish();
      if (progress.cancelled) throw new PublishCancelled();
      progress.publishClicked = true;
      state.finalClicks++;
      if (opts.afterClickMs) await sleep(opts.afterClickMs);
      return { success: true, url: 'https://blog.naver.com/vestra/1' };
    } catch (err) {
      return { success: false, error: String(err), cause: err, publishClicked: progress.publishClicked };
    }
  };
  return { publishOne, state };
}
function session(over = {}) {
  const s = { opened: 0, saved: 0 };
  return { s, openSession: async () => { s.opened++; return { page: 'PAGE', login: async () => ({ ok: true }), save: async () => { s.saved++; }, ...over }; } };
}
const deps = (api, publishOne, openSession, extra = {}) => ({ api, ownerId: 'u1', dryRun: false, deadlineMs: 5000, retryDelayMs: 1, openSession, publishOne, ...extra });

test('실배선: 최종 클릭 후 시간 초과 → unknown 보고(반납 금지 → 다음 실행 중복 게시 차단)', async () => {
  const api = fakeApi();
  const { publishOne, state } = fakePublishOne({ afterClickMs: 80 });
  const { openSession } = session();
  const result = await createWorkerRun(deps(api, publishOne, openSession, { deadlineMs: 30 })).run();
  assert.deepEqual(result, { status: 'unknown', reason: 'timeout', url: undefined });
  assert.equal(state.finalClicks, 1);
  assert.equal(state.pages[0], 'PAGE', '세션 page가 publishOne에 전달된다');
  assert.deepEqual(api.calls.at(-1), ['fail', 'unknown', 'timeout']);
  assert.equal(api.calls.some(c => c[1] === 'not_posted'), false);
  assert.equal(exitCodeOf(result), 1);
});

test('실배선: 클릭 전 시간 초과 → not_posted, 늦게 도착한 최종 클릭은 같은 progress로 차단', async () => {
  const api = fakeApi();
  const { publishOne, state } = fakePublishOne({ beforeClickMs: 60 });
  const { openSession } = session();
  const result = await createWorkerRun(deps(api, publishOne, openSession, { deadlineMs: 10 })).run();
  assert.deepEqual(result, { status: 'not_posted', reason: 'timeout' });
  await sleep(120);
  assert.equal(state.finalClicks, 0);
});

test('실배선: 종료 신호(abort) → 진행 중 claim의 같은 progress를 취소해 늦은 클릭 차단, 클릭 전이면 not_posted', async () => {
  const api = fakeApi();
  const { publishOne, state } = fakePublishOne({ beforeClickMs: 60 });
  const { openSession } = session();
  const worker = createWorkerRun(deps(api, publishOne, openSession));
  const running = worker.run();
  await sleep(20);
  await worker.abort('timeout');
  assert.deepEqual(api.calls.find(c => c[0] === 'fail'), ['fail', 'not_posted', 'timeout']);
  await running;
  assert.equal(state.finalClicks, 0, 'abort 이후 최종 클릭 없음');
  assert.equal(api.calls.some(c => c[0] === 'complete'), false);
});

test('실배선: 클릭 후 종료 신호 → unknown 보고', async () => {
  const api = fakeApi();
  const { publishOne } = fakePublishOne({ afterClickMs: 80 });
  const { openSession } = session();
  const worker = createWorkerRun(deps(api, publishOne, openSession));
  const running = worker.run();
  await sleep(30);
  await worker.abort('timeout');
  assert.deepEqual(api.calls.find(c => c[0] === 'fail'), ['fail', 'unknown', 'timeout']);
  await running;
});

test('소유자 불일치 claim → 브라우저도 열지 않고 fail(not_posted, owner_mismatch)', async () => {
  const api = fakeApi(item({ ownerId: 'u2' }));
  const { publishOne, state } = fakePublishOne({});
  const { s, openSession } = session();
  const result = await createWorkerRun(deps(api, publishOne, openSession)).run();
  assert.deepEqual(result, { status: 'owner_mismatch' });
  assert.equal(s.opened, 0);
  assert.equal(state.finalClicks, 0);
  assert.deepEqual(api.calls, [['fail', 'not_posted', 'owner_mismatch']]);
  assert.equal(exitCodeOf(result), 1);
});

test('정상 게시 → complete 후 세션 저장, 대상 없음 → 세션 열지 않음, 로그인 실패 → not_posted 사유 보고', async () => {
  let api = fakeApi();
  let { publishOne } = fakePublishOne({});
  let sess = session();
  const ok = await createWorkerRun(deps(api, publishOne, sess.openSession)).run();
  assert.equal(ok.status, 'published');
  assert.equal(sess.s.saved, 1);
  assert.deepEqual(api.calls.at(-1), ['complete', 'https://blog.naver.com/vestra/1']);

  sess = session();
  const idle = await createWorkerRun(deps(fakeApi(null), publishOne, sess.openSession)).run();
  assert.deepEqual(idle, { status: 'idle', reason: 'no_eligible_content' });
  assert.equal(sess.s.opened, 0);

  api = fakeApi();
  sess = session({ login: async () => ({ ok: false, reason: 'captcha_required' }) });
  ({ publishOne } = fakePublishOne({}));
  const login = await createWorkerRun(deps(api, publishOne, sess.openSession)).run();
  assert.deepEqual(login, { status: 'login_failed', reason: 'captcha_required' });
  assert.deepEqual(api.calls, [['fail', 'not_posted', 'captcha_required']]);
});
