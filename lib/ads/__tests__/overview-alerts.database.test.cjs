/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 개요의 안전 경보(최종 판정 B1·B4) — 실DB(PGlite). 메일이 실패해도 화면에서 보이게 DB의 경보를 그대로 싣는다.
// - alerts: 이 계정의 최근 48시간 pause_failed·guard_blind·cap_100·drift·inspect_denied(미발송 포함, 최신순). 다른 유형·남의 계정·오래된 것은 없다.
// - 미러 pauseUnconfirmed: 켜짐(userLock=false)인데 마지막 잠금 변경 뒤에 그 엔티티의 pause_failed(paused:false)가 있으면 true.
// - 계정 disconnectStuck: 'disconnecting'이 10분(STALE_CLAIM_MS) 넘게 이어지면 true(화면이 '해제 다시 시도'를 보인다).
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupAdsDb } = require('./fixtures/ads-db.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;
const NOW = new Date('2026-03-10T03:00:00Z');
const ago = (h) => new Date(NOW.getTime() - h * 3_600_000);
const BLOB = 'v1:0123456789abcdef:SEALEDCIPHERTEXT';

test('overview carries safety alerts and unconfirmed pauses', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async (t) => {
  const env = await setupAdsDb(packageDir);
  try {
    const { client } = env;
    const { getOverview } = require('../overview.ts');
    const { listAccounts } = require('../accounts.ts');
    const acc = await client.adAccount.create({ data: { ownerId: 'owner', naverCustomerId: '1234567', label: 'a', apiKeyEnc: BLOB, secretKeyEnc: BLOB, keyLast4: '1a2b' } });
    const theirs = await client.adAccount.create({ data: { ownerId: 'other', naverCustomerId: '7654321', label: 'b', apiKeyEnc: BLOB, secretKeyEnc: BLOB, keyLast4: 'zzzz' } });
    const alert = (type, createdAt, payload, extra = {}) => client.adAlert.create({ data: {
      ownerId: 'owner', adAccountId: acc.id, type, kstDate: '2026-03-10', payload, dedupeKey: String(payload.naverId ?? payload.reason ?? ''), createdAt, ...extra,
    } });

    await t.test('recent safety alerts of this account only, newest first, unsent included, payload trimmed to known fields', async () => {
      await alert('ads.pause_failed', ago(1), { reason: 'cap_100', entity: 'campaign', naverId: 'cmp-1', paused: false, secretish: 'x'.repeat(500) });
      await alert('ads.guard_blind', ago(2), { reason: 'spend_unknown', dailyCapKrw: 100000, sharedBudgetKrw: 100000 }, { sentAt: ago(2) });
      await alert('ads.cap_100', ago(3), { todayCostKrw: 100000, dailyCapKrw: 100000, paused: 2, pauseFailed: 1 });
      await alert('ads.drift', ago(4), { at: 'guard', entity: 'adgroup', naverId: 'grp-1', campaign: 'cmp-2', field: 'aiAdsOptIn', paused: true });
      await alert('ads.inspect_denied', ago(5), { entity: 'keyword', naverId: 'kw-1' });
      await alert('ads.cap_90', ago(1), { todayCostKrw: 90000 }); // 안전 경보 아님
      await alert('ads.bizmoney_low', ago(1), { bizmoneyKrw: 1 });
      await alert('ads.guard_blind', ago(49), { reason: 'deadline' }); // 48시간 밖
      await client.adAlert.create({ data: { ownerId: 'other', adAccountId: theirs.id, type: 'ads.pause_failed', kstDate: '2026-03-10', payload: { naverId: 'cmp-x', paused: false }, createdAt: ago(1) } });
      const o = await getOverview('owner', acc.id, NOW);
      assert.deepEqual(o.alerts.map((a) => [a.type, a.sent]), [
        ['ads.pause_failed', false], ['ads.guard_blind', true], ['ads.cap_100', false], ['ads.drift', false], ['ads.inspect_denied', false],
      ]);
      assert.deepEqual(o.alerts[0], { type: 'ads.pause_failed', at: ago(1).toISOString(), sent: false, reason: 'cap_100', entity: 'campaign', naverId: 'cmp-1', field: null, paused: false, pauseFailed: null });
      assert.deepEqual([o.alerts[2].pauseFailed, o.alerts[3].field, o.alerts[1].reason], [1, 'aiAdsOptIn', 'spend_unknown']);
      assert.equal(JSON.stringify(o.alerts).includes('xxxxx'), false, '알려진 필드만 싣는다');
    });

    await t.test('a lit mirror whose pause failed after its last lock change is pauseUnconfirmed; a later owner action clears it', async () => {
      const m = (naverId, extra) => client.adCampaign.create({ data: { ownerId: 'owner', adAccountId: acc.id, naverId, name: naverId, ...extra } });
      await m('cmp-1', { userLock: false, lockedBy: null, lockedAt: ago(10) }); // 끄기 실패(1시간 전) 뒤 아무 변화 없음
      await m('cmp-2', { userLock: false, lockedBy: null, lockedAt: ago(0.5) }); // 실패 뒤 대장이 다시 켬(잠금 변경이 더 늦다)
      await m('cmp-3', { userLock: true, lockedBy: 'guard', lockedAt: ago(10) }); // 실패 뒤 결국 꺼짐
      await m('cmp-4', { userLock: false, lockedBy: null, lockedAt: null }); // 경보 없음
      await alert('ads.pause_failed', ago(1), { reason: 'resume_race', entity: 'campaign', naverId: 'cmp-2', paused: false });
      await alert('ads.pause_failed', ago(1), { reason: 'drift', entity: 'campaign', naverId: 'cmp-3', paused: false });
      await alert('ads.pause_failed', ago(1), { reason: 'resume_race', entity: 'campaign', naverId: 'cmp-4', paused: true }); // 다시 끄기 성공 알림
      const o = await getOverview('owner', acc.id, NOW);
      const flag = Object.fromEntries(o.campaigns.map((c) => [c.naverId, c.pauseUnconfirmed]));
      assert.deepEqual(flag, { 'cmp-1': true, 'cmp-2': false, 'cmp-3': false, 'cmp-4': false });
    });

    await t.test('disconnecting for more than 10 minutes is disconnectStuck (accounts list and overview)', async () => {
      await client.adAccount.update({ where: { id: acc.id }, data: { status: 'disconnecting', updatedAt: new Date(Date.now() - 11 * 60_000) } });
      assert.equal((await listAccounts('owner')).find((a) => a.id === acc.id).disconnectStuck, true);
      await client.adAccount.update({ where: { id: acc.id }, data: { updatedAt: new Date(Date.now() - 5 * 60_000) } });
      assert.equal((await listAccounts('owner')).find((a) => a.id === acc.id).disconnectStuck, false, '10분 안은 진행 중');
      await client.adAccount.update({ where: { id: acc.id }, data: { status: 'active', updatedAt: new Date(Date.now() - 60 * 60_000) } });
      assert.equal((await getOverview('owner', acc.id, NOW)).account.disconnectStuck, false, '해제 중이 아니면 false');
    });
  } finally {
    await env.close();
  }
});
