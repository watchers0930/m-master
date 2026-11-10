/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 켜기·끄기 실패가 화면에 줄 사실(최종 판정 B3) — 실DB(PGlite) + 가짜 네이버.
// - 켜기 불확실(ads_uncertain)·해제 경합(resume_race)은 안전 재끄기 결과를 details.paused로 싣는다(false면 화면이 urgent).
// - 대장 끄기 PUT 실패도 ads.pause_failed(owner_pause_failed, paused:false)를 남겨 개요가 '꺼지지 않았을 수 있음'으로 보인다.
// 훅은 기록·장애 주입만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withPauseAlertEnv, pauseAlerts, json } = require('./fixtures/pause-alerts-env.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;

test('lock failures carry the safety-pause outcome', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, () => withPauseAlertEnv(packageDir, async (a) => {
  const S = a.naver.state, { client, db } = a.env;
  const { setLock } = require('../locks.ts');
  const { getOverview } = require('../overview.ts');
  const p = await a.approved();
  assert.equal((await a.apply(p.id)).body.data.status, 'applied');
  const m = await a.mirrors(p.id);
  const p2 = await a.approved(); // 키워드가 더 필요하다(제안 1개 = 키워드 3개)
  assert.equal((await a.apply(p2.id)).body.data.status, 'applied');
  const m2 = await a.mirrors(p2.id);
  for (const x of [...S.keywords, ...S.ads]) x.inspectStatus = 'APPROVED';
  S.spend.set(S.campaigns[0].nccCampaignId, 0);
  const row = (k) => client.adKeyword.findUniqueOrThrow({ where: { id: k.id } });
  const fail = async (k, locked) => {
    try { await setLock('owner', { type: 'keyword', id: k.id }, locked, (await row(k)).lockVersion); return null; }
    catch (e) { return { code: e.code ?? e.reason, status: e.status, details: e.details ?? null }; }
  };
  const isKwPut = (k, lock) => (c) => c.method === 'PUT' && c.path === `/ncc/keywords/${k.naverId}` && c.body?.userLock === lock;
  const [k0, k1, k2] = m.keywords, [k3, k4] = m2.keywords;

  // 켜기 PUT 불확실 → 안전 재끄기 성공 → paused:true
  S.hooks.after = (c) => (isKwPut(k0, false)(c) ? json(502, {}) : undefined);
  let r;
  try { r = await fail(k0, false); } finally { a.resetFaults(); }
  assert.deepEqual(r, { code: 'ads_uncertain', status: 502, details: { paused: true } });

  // 켜기 PUT 불확실 + 재끄기도 실패 → paused:false
  S.hooks.after = (c) => (isKwPut(k1, false)(c) ? json(502, {}) : undefined);
  S.hooks.before = (c) => (isKwPut(k1, true)(c) ? json(500, {}) : undefined);
  try { r = await fail(k1, false); } finally { a.resetFaults(); }
  assert.deepEqual(r, { code: 'ads_uncertain', status: 502, details: { paused: false } });

  // 켜는 사이 해제(계정 disconnecting) → 재끄기 성공/실패가 details.paused로
  const disconnectDuring = (k) => async (c) => { if (isKwPut(k, false)(c)) await db.query(`UPDATE ad_accounts SET status='disconnecting'`); return undefined; };
  S.hooks.before = disconnectDuring(k2);
  try { r = await fail(k2, false); } finally { a.resetFaults(); await db.query(`UPDATE ad_accounts SET status='active'`); }
  assert.deepEqual([r.code, r.details], ['resume_race', { paused: true }]);
  const dd = disconnectDuring(k3);
  S.hooks.before = async (c) => (isKwPut(k3, true)(c) ? json(500, {}) : dd(c));
  try { r = await fail(k3, false); } finally { a.resetFaults(); await db.query(`UPDATE ad_accounts SET status='active'`); }
  assert.deepEqual([r.code, r.details], ['resume_race', { paused: false }]);

  // 대장 끄기 PUT 실패 → 알림 + 개요에서 '꺼지지 않았을 수 있음'
  await client.adKeyword.update({ where: { id: k4.id }, data: { userLock: false, lockedBy: null } });
  S.keywords.find((x) => x.nccKeywordId === k4.naverId).userLock = false;
  S.hooks.before = (c) => (isKwPut(k4, true)(c) ? json(503, {}) : undefined);
  try { r = await fail(k4, true); } finally { a.resetFaults(); }
  assert.equal(r.code, 'ads_uncertain');
  const al = (await pauseAlerts(client)).filter((x) => x.payload.naverId === k4.naverId);
  assert.deepEqual(al.map((x) => [x.payload.reason, x.payload.paused]), [['owner_pause_failed', false]]);
  const o = await getOverview('owner', a.accountId);
  assert.equal(o.keywords.find((x) => x.id === k4.id).pauseUnconfirmed, true);
}));
