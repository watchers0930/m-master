/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 안전 끄기 실패는 숨지 않는다(Task 9 판정 round 2) — 켜기 경합 재끄기 실패 + 끄기 전용 래퍼 고정. 실DB(PGlite) + 가짜 네이버.
// 끄기가 실패하면 결과와 무관하게 미러 userLock=false(켜짐·모름) + 알림 ads.pause_failed. 같은 날 ads.drift가 먼저 있어도 묻히지 않는다.
// 훅은 기록·장애 주입만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withPauseAlertEnv, pauseAlerts, json } = require('./fixtures/pause-alerts-env.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;
const skip = !packageDir && 'Set PGLITE_SOCKET_PACKAGE';

test('resume_race re-pause fails → mirror userLock=false + ads.pause_failed(resume_race); pause-only wrapper sends only pause bodies', { skip }, () => withPauseAlertEnv(packageDir, async (a) => {
  const S = a.naver.state, { client } = a.env;
  const { setLock } = require('../locks.ts');
  const { clientForPause } = require('../../external/naver-searchad.ts');
  const p = await a.approved();
  assert.equal((await a.apply(p.id)).body.data.status, 'applied');
  const camp = (await a.mirrors(p.id)).campaigns[0];
  // 래퍼 고정(X2): 끄기 본문 외에는 네트워크 호출 0
  const pc = clientForPause(await a.account(), a.naver.fn);
  const n0 = S.calls.length;
  await assert.rejects(pc.put(`/ncc/campaigns/${camp.naverId}`, { nccCampaignId: camp.naverId, userLock: false }, { fields: 'userLock' }), /pause_only/);
  await assert.rejects(pc.put(`/ncc/campaigns/${camp.naverId}`, { nccCampaignId: camp.naverId, userLock: true, dailyBudget: 1 }, { fields: 'userLock' }), /pause_only/);
  await assert.rejects(pc.post('/ncc/campaigns', {}), /pause_only/);
  assert.equal(S.calls.length, n0, '거부된 요청은 보내지 않는다');
  await pc.put(`/ncc/campaigns/${camp.naverId}`, { nccCampaignId: camp.naverId, userLock: true }, { fields: 'userLock' });
  assert.equal(S.calls.length, n0 + 1, '끄기 본문은 보낸다');
  // 해제가 켜기 PUT 도중 끝나고, 그 뒤 재끄기 PUT이 500
  await client.adCampaign.update({ where: { id: camp.id }, data: { lockedBy: 'owner' } });
  S.spend.set(camp.naverId, 0);
  const { disconnectAccount } = require('../disconnect.ts');
  let ran = null;
  S.hooks.before = async (c) => {
    const mine = c.method === 'PUT' && c.path === `/ncc/campaigns/${camp.naverId}`;
    if (mine && c.body?.userLock === false && !ran) {
      ran = 'started';
      try { await disconnectAccount('owner', a.accountId); ran = 'done'; } catch (e) { ran = `err:${e.code ?? e.message}`; }
      return undefined;
    }
    if (mine && ran === 'done' && c.body?.userLock === true) return json(500, {});
    return undefined;
  };
  const row = await client.adCampaign.findUniqueOrThrow({ where: { id: camp.id } });
  let code;
  try { await setLock('owner', { type: 'campaign', id: camp.id }, false, row.lockVersion); code = 'ok'; } catch (e) { code = e.code; } finally { a.resetFaults(); }
  assert.equal(ran, 'done');
  assert.equal(code, 'resume_race');
  assert.equal(S.campaigns.find((c) => c.nccCampaignId === camp.naverId).userLock, false, '네이버에서는 켜진 채(재끄기 실패)');
  assert.equal((await client.adCampaign.findUniqueOrThrow({ where: { id: camp.id } })).userLock, false, '미러도 사실대로 켜짐');
  const al = await pauseAlerts(client);
  assert.equal(al.length, 1, '알림 없이 조용히 지나가지 않는다');
  assert.deepEqual([al[0].payload.reason, al[0].payload.paused], ['resume_race', false]);
}));
