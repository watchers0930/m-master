/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 끄기·가드 해제·해제 경합(Task 9 fix round 1) — 실DB(PGlite) + 가짜 네이버.
// - 끄기는 정책 게이트 없음: 스위치 off·invalid_key·disconnecting·버전 불일치에도 보낸다(의도는 네트워크 전에 미러에 기록). disabled는 keys_removed.
// - guard 잠금은 lockedAt의 KST 날짜가 오늘보다 이를 때만(자동 재개 누락) 대장이 켤 수 있다. 미래 lockedAt은 오늘로 본다. 상위(그룹·캠페인)도 재조회 대조.
// - 해제(disconnect)가 켜기 PUT 도중 끝나면: 켜기 뒤 계정 상태 재확인 → 끄기 전용 클라이언트로 즉시 끄기 + 알림(resume_race).
// 훅은 기록·장애 주입만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupApplyEnv } = require('./fixtures/apply-env.cjs');
const { json } = require('./fixtures/fake-naver.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;

test('ads pause, guard unlock and disconnect race on a real database', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async (t) => {
  const a = await setupApplyEnv(packageDir);
  const { env, naver, approved, apply, lock, puts, mirrors, resetFaults } = a;
  const { client, db } = env;
  const S = naver.state;
  const { setLock } = require('../locks.ts');
  try {
    const p = await approved();
    assert.equal((await apply(p.id)).body.data.status, 'applied');
    const m = await mirrors(p.id);
    const kw = m.keywords[0];
    const kwRow = () => client.adKeyword.findUniqueOrThrow({ where: { id: kw.id } });
    const kwPuts = () => puts(new RegExp(`^/ncc/keywords/${kw.naverId}$`)).filter((c) => c.body.userLock === true).length;
    const setStatus = (status) => db.query(`UPDATE ad_accounts SET status=$1`, [status]);
    for (const x of [...S.keywords, ...S.ads]) x.inspectStatus = 'APPROVED';
    S.spend.set(S.campaigns[0].nccCampaignId, 1000);

    await t.test('pause works for invalid_key and disconnecting accounts, with the kill switch off and a stale version; disabled is refused', async () => {
      process.env.ADS_EXECUTION_ENABLED = 'false';
      try {
        for (const status of ['invalid_key', 'disconnecting', 'active']) {
          await setStatus(status);
          const before = await kwRow();
          const n0 = kwPuts();
          const r = await lock('keyword', kw.id, { locked: true, expected_lock_version: before.lockVersion + 7 });
          assert.equal(r.status, 200, `${status}: ${JSON.stringify(r.body)}`);
          assert.equal(kwPuts(), n0 + 1, `${status}: 끄기 PUT`);
          const after = await kwRow();
          assert.deepEqual([after.lockedBy, after.lockVersion, after.userLock], ['owner', before.lockVersion + 1, true], status);
        }
        await setStatus('disabled');
        const n0 = kwPuts();
        const r = await lock('keyword', kw.id, { locked: true, expected_lock_version: 0 });
        assert.deepEqual([r.status, r.body.error.code], [409, 'keys_removed']);
        assert.equal(kwPuts(), n0);
      } finally { process.env.ADS_EXECUTION_ENABLED = 'true'; await setStatus('active'); }
    });

    await t.test('pause intent is recorded before the network call (PUT fails → intent stays)', async () => {
      const before = await kwRow();
      await client.adKeyword.update({ where: { id: kw.id }, data: { lockedBy: 'pending_launch' } });
      S.hooks.before = (c) => (c.method === 'PUT' ? json(503, {}) : undefined);
      let r;
      try { r = await lock('keyword', kw.id, { locked: true, expected_lock_version: before.lockVersion }); } finally { resetFaults(); }
      assert.equal(r.status, 502);
      const after = await kwRow();
      assert.deepEqual([after.lockedBy, after.lockVersion], ['owner', before.lockVersion + 1]);
    });

    await t.test('pause always wins over a concurrent change and never launders a guard lock', async () => {
      const row = await kwRow();
      const guard = async (tx, locked) => { await tx.$executeRawUnsafe(`UPDATE ad_keywords SET locked_by='guard', lock_version=lock_version+1 WHERE id=$1`, locked.id); };
      const n0 = kwPuts();
      const out = await setLock('owner', { type: 'keyword', id: kw.id }, true, row.lockVersion, { afterLock: guard });
      assert.equal(out.lockedBy, 'guard');
      assert.equal(kwPuts(), n0 + 1);
    });

    const KST_MIDNIGHT = new Date('2026-11-10T15:00:00.000Z'); // = 2026-11-11 00:00 KST
    const guardAt = async (lockedAt) => client.adKeyword.update({ where: { id: kw.id }, data: { lockedBy: 'guard', lockedAt, userLock: true } });
    const unlockAt = async (now) => {
      const row = await kwRow();
      try { return ['ok', (await setLock('owner', { type: 'keyword', id: kw.id }, false, row.lockVersion, { now: () => now })).userLock]; } catch (e) { return [e.code]; }
    };

    await t.test('guard unlock: same KST day (incl. 15:00:00Z boundary, future, null) refused; earlier KST day allowed', async () => {
      for (const [label, lockedAt] of [['same instant', KST_MIDNIGHT], ['future', new Date(KST_MIDNIGHT.getTime() + 86_400_000)], ['2s ahead', new Date(KST_MIDNIGHT.getTime() + 2000)], ['null', null]]) {
        await guardAt(lockedAt);
        assert.deepEqual(await unlockAt(KST_MIDNIGHT), ['guard_locked'], label);
      }
      await guardAt(new Date('2026-11-10T14:59:59.000Z')); // KST 11-10 23:59:59 → 오늘(11-11)보다 이르다
      assert.deepEqual(await unlockAt(KST_MIDNIGHT), ['ok', false]);
      assert.equal(S.keywords.find((x) => x.nccKeywordId === kw.naverId).userLock, false);
    });

    await t.test('guard unlock re-verifies ancestors (group, campaign) on a fresh read', async () => {
      const group = S.adgroups.find((g) => g.nccAdgroupId === kw.parentNaverId);
      const camp = S.campaigns.find((c) => c.nccCampaignId === group.nccCampaignId);
      for (const [target, field, value] of [[group, 'useExpSearch', true], [camp, 'useDailyBudget', false]]) {
        S.keywords.find((x) => x.nccKeywordId === kw.naverId).userLock = true;
        await guardAt(new Date('2026-11-09T00:00:00.000Z'));
        const saved = target[field];
        target[field] = value;
        try {
          const row = await kwRow();
          await assert.rejects(setLock('owner', { type: 'keyword', id: kw.id }, false, row.lockVersion, { now: () => KST_MIDNIGHT }),
            (e) => e.code === 'drift' && e.details?.field === field, field);
        } finally { target[field] = saved; }
        assert.equal(S.keywords.find((x) => x.nccKeywordId === kw.naverId).userLock, true, `${field}: 켜지 않음`);
      }
    });

    await t.test('disconnect completes while our campaign resume PUT is in flight → re-paused, resume_race alert', async () => {
      await client.adAlert.deleteMany();
      const camp = m.campaigns[0];
      await client.adCampaign.update({ where: { id: camp.id }, data: { lockedBy: 'owner' } });
      const { disconnectAccount } = require('../disconnect.ts');
      let ran = null;
      S.hooks.before = async (c) => {
        if (c.method === 'PUT' && c.path === `/ncc/campaigns/${camp.naverId}` && c.body?.userLock === false && !ran) {
          ran = 'started';
          try { await disconnectAccount('owner', a.accountId); ran = 'done'; } catch (e) { ran = `err:${e.code ?? e.message}`; }
        }
      };
      const row = await client.adCampaign.findUniqueOrThrow({ where: { id: camp.id } });
      let code;
      try { await setLock('owner', { type: 'campaign', id: camp.id }, false, row.lockVersion); code = 'ok'; } catch (e) { code = e.code; } finally { resetFaults(); }
      assert.equal(ran, 'done');
      assert.equal(code, 'resume_race');
      const acc = await a.account();
      assert.deepEqual([acc.status, acc.apiKeyEnc], ['disabled', null]);
      assert.equal(S.campaigns.find((c) => c.nccCampaignId === camp.naverId).userLock, true, '키 삭제 뒤에도 끄기 전용 클라이언트로 다시 껐다');
      const alert = (await client.adAlert.findMany({ where: { type: 'ads.drift' } })).find((x) => x.payload.reason === 'resume_race');
      assert.ok(alert);
      // 켜기 의도 +1, 해제 ⓪ +1, 해제 ③ +1, 경합 재끄기 +1 — 해제가 lockVersion을 올리지 않으면 +2
      assert.equal((await client.adCampaign.findUniqueOrThrow({ where: { id: camp.id } })).lockVersion, row.lockVersion + 4, '해제도 lockVersion을 올린다');
    });
  } finally {
    delete process.env.ADS_EXECUTION_ENABLED;
    await env.close();
  }
});
