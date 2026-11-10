/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 끄기 PUT은 200인데 다시 읽으면 여전히 켜짐(Task 9 fix round 3 I-1) — 켜기 경합 재끄기(safetyPause). 실DB(PGlite) + 가짜 네이버(ignorePause).
// 끄기 확인 = 재조회 userLock===true. 아니면 모든 경로에서 끄기 실패: 미러 userLock=false + ads.pause_failed(같은 날 ads.drift가 먼저 있어도).
// 훅은 기록·장애 주입만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withPauseAlertEnv, pauseAlerts } = require('./fixtures/pause-alerts-env.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;
const skip = !packageDir && 'Set PGLITE_SOCKET_PACKAGE';

test('resume_race re-pause 200 but still ON on re-read → mirror false + ads.pause_failed(paused:false)', { skip }, () => withPauseAlertEnv(packageDir, async (a) => {
  const S = a.naver.state, { client } = a.env;
  const { setLock } = require('../locks.ts');
  const { disconnectAccount } = require('../disconnect.ts');
  const p = await a.approved();
  assert.equal((await a.apply(p.id)).body.data.status, 'applied');
  const camp = (await a.mirrors(p.id)).campaigns[0];
  await client.adCampaign.update({ where: { id: camp.id }, data: { lockedBy: 'owner' } });
  S.spend.set(camp.naverId, 0);
  S.ignorePause.add(camp.naverId); // 켜기는 반영, 끄기는 200이지만 무시
  let ran = null;
  S.hooks.before = async (c) => {
    if (c.method === 'PUT' && c.path === `/ncc/campaigns/${camp.naverId}` && c.body?.userLock === false && !ran) {
      ran = 'started';
      try { await disconnectAccount('owner', a.accountId); ran = 'done'; } catch (e) { ran = `err:${e.code ?? e.message}`; }
    }
    return undefined;
  };
  const row = await client.adCampaign.findUniqueOrThrow({ where: { id: camp.id } });
  let code;
  try { await setLock('owner', { type: 'campaign', id: camp.id }, false, row.lockVersion); code = 'ok'; } catch (e) { code = e.code; } finally { a.resetFaults(); }
  assert.deepEqual([ran, code], ['done', 'resume_race']);
  assert.equal(S.campaigns.find((c) => c.nccCampaignId === camp.naverId).userLock, false);
  assert.equal((await client.adCampaign.findUniqueOrThrow({ where: { id: camp.id } })).userLock, false);
  const al = await pauseAlerts(client);
  assert.deepEqual([al.length, al[0]?.payload.reason, al[0]?.payload.paused], [1, 'resume_race', false]);
}));
