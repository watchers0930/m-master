/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 켜기·끄기 경로의 안전 끄기(Task 9 fix round 3) — 실DB(PGlite) + 가짜 네이버.
// - lock_race 재끄기 실패 → 미러 false + ads.pause_failed(lock_race)  - 켜기 PUT 불확실(실제로는 켜짐) → 안전 끄기로 다시 끔
// - 대장 끄기 PUT 실패 → 미러 false  - 대장 끄기 200인데 재조회 켜짐 → 미러 false + 502 pause_unconfirmed
// 같은 날 ads.drift를 먼저 심고 알림은 지우지 않는다. 훅은 기록·장애 주입만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withPauseAlertEnv, pauseAlerts, json } = require('./fixtures/pause-alerts-env.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;

test('lock paths: every safety pause records the truth and alerts', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, () => withPauseAlertEnv(packageDir, async (a) => {
  const S = a.naver.state, { client, db } = a.env;
  const { setLock } = require('../locks.ts');
  const p = await a.approved();
  assert.equal((await a.apply(p.id)).body.data.status, 'applied');
  const m = await a.mirrors(p.id);
  for (const x of [...S.keywords, ...S.ads]) x.inspectStatus = 'APPROVED';
  S.spend.set(S.campaigns[0].nccCampaignId, 0);
  const kwN = (k) => S.keywords.find((x) => x.nccKeywordId === k.naverId);
  const row = (k) => client.adKeyword.findUniqueOrThrow({ where: { id: k.id } });
  const unlock = async (k) => { try { await setLock('owner', { type: 'keyword', id: k.id }, false, (await row(k)).lockVersion); return 'ok'; } catch (e) { return e.code ?? e.reason; } };

  // Z7b: 켜는 사이 가드가 잠그고, 우리 재끄기는 500
  const k0 = m.keywords[0];
  S.hooks.before = async (c) => {
    if (c.method !== 'PUT' || c.path !== `/ncc/keywords/${k0.naverId}`) return undefined;
    if (c.body.userLock === false) { await db.query(`UPDATE ad_keywords SET locked_by='guard', lock_version=lock_version+1, locked_at=$2 WHERE id=$1`, [k0.id, new Date().toISOString()]); return undefined; }
    return json(500, {});
  };
  let code;
  try { code = await unlock(k0); } finally { a.resetFaults(); }
  assert.equal(code, 'lock_race');
  assert.equal(kwN(k0).userLock, false, '네이버에서는 켜진 채');
  assert.equal((await row(k0)).userLock, false, '미러도 사실대로');
  const al = await pauseAlerts(client);
  assert.deepEqual([al.length, al[0]?.payload.reason, al[0]?.payload.paused], [1, 'lock_race', false]);

  // Z7c: 켜기 PUT이 반영됐는데 응답 502(불확실) → 안전 끄기로 다시 끈다
  const k1 = m.keywords[1];
  S.hooks.after = (c) => (c.method === 'PUT' && c.path === `/ncc/keywords/${k1.naverId}` && c.body.userLock === false ? json(502, {}) : undefined);
  try { code = await unlock(k1); } finally { a.resetFaults(); }
  assert.equal(code, 'ads_uncertain');
  assert.equal(kwN(k1).userLock, true, '불확실한 켜기는 안전 방향으로 다시 끈다');
  assert.deepEqual([(await row(k1)).userLock, (await row(k1)).lockedBy], [true, 'pending_launch'], '사실대로 기록 + 잠금 복원');

  // Z1d: 대장 끄기 PUT 실패 → 미러 false(켜짐·모름)
  const k2 = m.keywords[2];
  assert.equal((await row(k2)).userLock, true);
  S.hooks.before = (c) => (c.method === 'PUT' ? json(503, {}) : undefined);
  try { await assert.rejects(setLock('owner', { type: 'keyword', id: k2.id }, true, 0), (e) => e.reason === 'ads_uncertain'); } finally { a.resetFaults(); }
  assert.deepEqual([(await row(k2)).userLock, (await row(k2)).lockedBy], [false, 'owner']);

  // 대장 끄기 200인데 재조회 켜짐 → 미러 false + 502 pause_unconfirmed
  const ad = m.creatives[0];
  S.ads.find((x) => x.nccAdId === ad.naverId).userLock = false;
  S.ignorePause.add(ad.naverId);
  try {
    await assert.rejects(setLock('owner', { type: 'ad', id: ad.id }, true, 0), (e) => e.code === 'pause_unconfirmed' && e.status === 502);
  } finally { a.resetFaults(); }
  assert.equal((await client.adCreative.findUniqueOrThrow({ where: { id: ad.id } })).userLock, false);
}));
