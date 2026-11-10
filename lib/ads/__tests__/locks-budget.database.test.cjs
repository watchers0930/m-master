/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process, AbortController */
// 켜기 경로의 시간 예산(최종 판정 A2, lock route maxDuration 300): PUT 전 조회(freshCheck·비용)는 LOCK_READ_WINDOW_MS 안에서만 시작한다.
// 창을 넘기면 켜기 PUT을 보내지 않는다(점유 전이라 미러 그대로). 점유 뒤(켜기 PUT → 불확실 재끄기 PUT → 재조회)는 창과 무관하게 끝까지 간다.
// 실DB(PGlite) + 가짜 네이버 + 주입 시계. 훅은 시계 이동·장애 주입만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withPauseAlertEnv, json } = require('./fixtures/pause-alerts-env.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;

test('lock resume: pre-PUT reads are budgeted, the post-claim safety chain is not', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, () => withPauseAlertEnv(packageDir, async (a) => {
  const S = a.naver.state, { client } = a.env;
  const { setLock, LOCK_READ_WINDOW_MS } = require('../locks.ts');
  const p = await a.approved();
  assert.equal((await a.apply(p.id)).body.data.status, 'applied');
  const m = await a.mirrors(p.id);
  for (const x of [...S.keywords, ...S.ads]) x.inspectStatus = 'APPROVED';
  S.spend.set(S.campaigns[0].nccCampaignId, 0);
  let t = 1_000_000;
  const naverClock = { now: () => t, sleep: async (ms) => { t += ms; }, timeout: () => new AbortController().signal };
  const kwN = (k) => S.keywords.find((x) => x.nccKeywordId === k.naverId);
  const row = (k) => client.adKeyword.findUniqueOrThrow({ where: { id: k.id } });
  const unlock = async (k) => {
    try { await setLock('owner', { type: 'keyword', id: k.id }, false, (await row(k)).lockVersion, { naverClock }); return 'ok'; }
    catch (e) { return e.code ?? e.reason; }
  };
  const resumePuts = (k, from) => S.calls.slice(from).filter((c) => c.method === 'PUT' && c.path === `/ncc/keywords/${k.naverId}` && c.body?.userLock === false).length;
  assert.equal(LOCK_READ_WINDOW_MS, 180_000);

  // 조회가 느려 창(180초)을 넘김 → 다음 조회를 시작하지 않고, 켜기 PUT은 0회, 미러 잠금 그대로
  const k0 = m.keywords[0];
  const before0 = await row(k0);
  let from = S.calls.length;
  S.hooks.before = (c) => { if (c.method === 'GET') t += 100_000; return undefined; };
  let code;
  try { code = await unlock(k0); } finally { a.resetFaults(); }
  assert.equal(code, 'ads_unavailable');
  assert.equal(S.calls.slice(from).filter((c) => c.method === 'GET').length, 2, '창을 넘긴 뒤 세 번째 조회는 시작하지 않는다');
  assert.equal(resumePuts(k0, from), 0);
  const after0 = await row(k0);
  assert.deepEqual([after0.lockedBy, after0.lockVersion, kwN(k0).userLock], [before0.lockedBy, before0.lockVersion, true]);

  // 마지막 조회(/stats) 도중 시계가 창을 넘겨도, 점유 뒤 켜기 PUT과 불확실 재끄기(PUT + 재조회)는 끝까지 간다
  const k1 = m.keywords[1];
  from = S.calls.length;
  S.hooks.before = (c) => { if (c.path === '/stats') t += 181_000; return undefined; };
  S.hooks.after = (c) => (c.method === 'PUT' && c.path === `/ncc/keywords/${k1.naverId}` && c.body.userLock === false ? json(502, {}) : undefined);
  try { code = await unlock(k1); } finally { a.resetFaults(); }
  assert.equal(code, 'ads_uncertain');
  const later = S.calls.slice(from).filter((c) => c.path === `/ncc/keywords/${k1.naverId}`);
  assert.deepEqual(later.map((c) => [c.method, c.body?.userLock ?? null]).slice(-3), [['PUT', false], ['PUT', true], ['GET', null]], '켜기 → 재끄기 → 재조회');
  assert.equal(kwN(k1).userLock, true, '불확실한 켜기는 다시 꺼졌다');
  assert.equal((await row(k1)).userLock, true);
}));
