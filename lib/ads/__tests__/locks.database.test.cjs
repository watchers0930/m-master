/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process, __dirname */
// 켜기·끄기(setLock) — 실DB(PGlite) + 가짜 네이버: 비상 정지(끄기는 항상 허용, 켜기는 503), 켜기 전제(제안 applied·상한 미만·
// 검수 APPROVED|ELIGIBLE을 네이버에서 새로 읽음·재조회 대조), (lockedBy, lockVersion) CAS로 가드↔대장 경합 해결.
// 훅(afterLock·가짜 전송)은 기록·장애 주입만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setupApplyEnv } = require('./fixtures/apply-env.cjs');
const { json } = require('./fixtures/fake-naver.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;

test('ads entity lock/unlock on a real database', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async (t) => {
  const a = await setupApplyEnv(packageDir);
  const { env, naver, approved, apply, lock, puts, mirrors, resetFaults } = a;
  const { client, db } = env;
  const { setLock } = require('../locks.ts');
  try {
    const p = await approved();
    assert.equal((await apply(p.id)).body.data.status, 'applied');
    const m = await mirrors(p.id);
    const kwRow = () => client.adKeyword.findUniqueOrThrow({ where: { id: m.keywords[0].id } });
    const kwNaver = () => naver.state.keywords.find((x) => x.nccKeywordId === m.keywords[0].naverId);
    const campaignIds = () => naver.state.campaigns.map((c) => c.nccCampaignId);
    const setSpend = (total) => { naver.state.spend.clear(); campaignIds().forEach((id, i) => naver.state.spend.set(id, i === 0 ? total : 0)); };
    const approve = () => { for (const x of [...naver.state.keywords, ...naver.state.ads]) x.inspectStatus = 'APPROVED'; };
    const unlock = async (row = null) => lock('keyword', m.keywords[0].id, { locked: false, expected_lock_version: (row ?? (await kwRow())).lockVersion });
    const resumePuts = () => puts(/^\/ncc\/keywords\//).filter((c) => c.body.userLock === false).length;
    setSpend(0);

    await t.test('launch blocked when cap reached or not approved by inspection', async () => {
      let r = await unlock();
      assert.deepEqual([r.status, r.body.error.code], [409, 'not_inspected'], '검수 중(UNDER_REVIEW)');
      approve();
      await client.adKeyword.update({ where: { id: m.keywords[0].id }, data: { inspectStatus: 'UNDER_REVIEW' } });
      setSpend(10000);
      r = await unlock();
      assert.deepEqual([r.status, r.body.error.code, r.body.error.todayCostKrw, r.body.error.dailyCapKrw], [409, 'cap_reached', 10000, 10000]);
      for (const body of [undefined, { data: 'x' }, { rows: [] }, [{ id: campaignIds()[0], salesAmt: 1 }]]) {
        naver.state.hooks.after = (c) => (c.path === '/stats' ? json(200, body) : undefined);
        r = await unlock();
        assert.deepEqual([r.status, r.body.error.code], [409, 'spend_unknown'], `빈 본문·형식 오류는 0이 아니라 모름: ${JSON.stringify(body)}`);
      }
      naver.state.hooks.after = (c) => (c.path === '/stats' ? json(200, { data: [{ id: campaignIds()[0], salesAmt: 'lots' }] }) : undefined);
      r = await unlock();
      assert.deepEqual([r.status, r.body.error.code], [409, 'spend_unknown'], '형식 불일치도 0으로 보지 않는다');
      resetFaults();
      const statsCall = naver.state.calls.filter((c) => c.path === '/stats').at(-1);
      assert.deepEqual(statsCall.query.ids.split(',').sort(), campaignIds().sort(), '계정 전체 캠페인 합산');
      assert.equal(resumePuts(), 0, '여기까지 켜기 PUT 0');
      await client.adProposal.update({ where: { id: p.id }, data: { status: 'apply_failed' } });
      setSpend(9999.9);
      r = await unlock();
      assert.deepEqual([r.status, r.body.error.code], [409, 'not_launchable'], '제안이 applied가 아니면 켜지 않는다');
      await client.adProposal.update({ where: { id: p.id }, data: { status: 'applied' } });
      // 유효한 응답에서 빠진 캠페인(새 캠페인 등 활동 없음) = 0원 → 나머지 합계가 상한 미만이면 켤 수 있다
      naver.state.spend.clear();
      naver.state.spend.set(campaignIds()[0], 9999.9);
      naver.state.campaigns.push({ nccCampaignId: 'cmp-new-no-stats', name: 'new', userLock: true, status: 'PAUSED' });
      r = await unlock();
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.deepEqual([r.body.data.userLock, r.body.data.lockedBy, r.body.data.lockVersion], [false, null, 1]);
      assert.equal(kwNaver().userLock, false);
      const put = puts(/^\/ncc\/keywords\//).at(-1);
      assert.deepEqual([put.query.fields, put.body], ['userLock', { nccKeywordId: m.keywords[0].naverId, userLock: false }], '최소 본문');
      const row = await kwRow();
      assert.equal(row.inspectStatus, 'APPROVED', '네이버에서 새로 읽은 검수 상태로 미러 갱신');
    });

    await t.test('kill switch blocks apply but allows lock', async () => {
      process.env.ADS_EXECUTION_ENABLED = 'false';
      try {
        let row = await kwRow();
        let r = await lock('keyword', row.id, { locked: true, expected_lock_version: row.lockVersion });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.deepEqual([r.body.data.userLock, r.body.data.lockedBy], [true, 'owner']);
        assert.equal(kwNaver().userLock, true);
        row = await kwRow();
        const n0 = resumePuts();
        r = await unlock(row);
        assert.deepEqual([r.status, r.body.error.code], [503, 'ads_paused']);
        assert.equal(resumePuts(), n0);
        const q = await approved();
        r = await apply(q.id);
        assert.deepEqual([r.status, r.body.error.code], [503, 'ads_paused']);
      } finally { process.env.ADS_EXECUTION_ENABLED = 'true'; }
    });

    await t.test('guard vs owner lock race resolved by CAS', async (t2) => {
      await t2.test('stale expected_lock_version → 409 version_conflict, no PUT', async () => {
        const row = await kwRow();
        const n = naver.state.calls.filter((c) => c.method === 'PUT').length;
        const r = await lock('keyword', row.id, { locked: false, expected_lock_version: row.lockVersion - 1 });
        assert.deepEqual([r.status, r.body.error.code, r.body.error.lock_version], [409, 'version_conflict', row.lockVersion]);
        assert.equal(naver.state.calls.filter((c) => c.method === 'PUT').length, n);
      });

      await t2.test('guard locks after our read (same tx seam) → CAS hits 0 rows → 409, no PUT', async () => {
        const row = await kwRow();
        const n = naver.state.calls.filter((c) => c.method === 'PUT').length;
        const guard = async (tx, locked) => { await tx.$executeRawUnsafe(`UPDATE ad_keywords SET locked_by='guard', lock_version=lock_version+1 WHERE id=$1`, locked.id); };
        for (const locked of [false]) { // 끄기는 CAS로 막지 않는다(locks-pause.database.test.cjs)
          await assert.rejects(setLock('owner', { type: 'keyword', id: row.id }, locked, row.lockVersion, { afterLock: guard }), (e) => e.code === 'version_conflict' && e.status === 409);
        }
        assert.equal(naver.state.calls.filter((c) => c.method === 'PUT').length, n);
        assert.deepEqual([(await kwRow()).lockedBy, (await kwRow()).lockVersion], [row.lockedBy, row.lockVersion], '훅 변경도 롤백');
        // 다른 탭이 같은 lockedBy로 바꾼 경우(lockVersion만 증가)도 막혀야 한다 — CAS는 lockedBy만이 아니라 lockVersion까지 본다
        const tab = async (tx, locked) => { await tx.$executeRawUnsafe(`UPDATE ad_keywords SET lock_version=lock_version+1 WHERE id=$1`, locked.id); };
        for (const locked of [false]) { // 끄기는 CAS로 막지 않는다(locks-pause.database.test.cjs)
          await assert.rejects(setLock('owner', { type: 'keyword', id: row.id }, locked, row.lockVersion, { afterLock: tab }), (e) => e.code === 'version_conflict' && e.status === 409);
        }
        assert.equal(naver.state.calls.filter((c) => c.method === 'PUT').length, n);
      });

      await t2.test('guard locks while our resume PUT is in flight → our record fails → re-pause, 409 lock_race', async () => {
        const row = await kwRow();
        naver.state.hooks.before = async (c) => {
          if (c.method === 'PUT' && c.body?.userLock === false) await db.query(`UPDATE ad_keywords SET locked_by='guard', lock_version=lock_version+1, locked_at=$2 WHERE id=$1`, [row.id, new Date().toISOString()]);
        };
        let r;
        try { r = await unlock(row); } finally { resetFaults(); }
        assert.deepEqual([r.status, r.body.error.code], [409, 'lock_race']);
        assert.equal(kwNaver().userLock, true, '안전 방향으로 다시 끈다');
        const after = await kwRow();
        assert.deepEqual([after.lockedBy, after.userLock], ['guard', true]);
      });

      await t2.test('guard lock: owner unlock refused the same KST day; owner pause overrides guard (Task 11 I-2); allowed later', async () => {
        let row = await kwRow();
        assert.equal(row.lockedBy, 'guard');
        const calls0 = naver.state.calls.length;
        let r = await unlock(row);
        assert.deepEqual([r.status, r.body.error.code], [409, 'guard_locked']);
        assert.equal(naver.state.calls.length, calls0, '가드 잠금은 네이버 조회 전에 거절');
        r = await lock('keyword', row.id, { locked: true, expected_lock_version: row.lockVersion });
        assert.deepEqual([r.status, r.body.data.lockedBy], [200, 'owner'], '대장 끄기는 guard를 owner로 덮는다 — 다음 날 자동 재개 대상이 아니다(판정 Task 11 I-2)');
        row = await kwRow();
        // 세탁 방지는 상한 검사가 맡는다: 같은 날 상한 상태에서 owner로 바뀐 것을 켜려 해도 cap_reached
        setSpend(10000);
        r = await unlock(row);
        assert.deepEqual([r.status, r.body.error.code], [409, 'cap_reached'], '끄기로 owner가 돼도 같은 날 상한이면 켜지 않는다');
        setSpend(0);
        row = await kwRow();
        await client.adKeyword.update({ where: { id: row.id }, data: { lockedAt: new Date(Date.now() - 36 * 3600_000) } });
        r = await unlock();
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(kwNaver().userLock, false);
      });

      await t2.test('account disconnected between checks and the resume PUT → no resume sent', async () => {
        let row = await kwRow();
        let r = await lock('keyword', row.id, { locked: true, expected_lock_version: row.lockVersion });
        assert.equal(r.status, 200);
        row = await kwRow();
        naver.state.hooks.before = async (c) => { if (c.path === '/stats') await db.exec(`UPDATE ad_accounts SET status='disconnecting'`); };
        const n0 = resumePuts();
        try { r = await unlock(row); } finally { resetFaults(); await db.exec(`UPDATE ad_accounts SET status='active'`); }
        assert.deepEqual([r.status, r.body.error.code], [409, 'ads_not_connected']);
        assert.equal(resumePuts(), n0);
        const after = await kwRow();
        assert.deepEqual([after.lockedBy, after.userLock], ['owner', true], '잠금 기록 복원');
      });
    });

    await t.test('unlock re-verifies stored settings: drifted group is not resumed and alerts', async () => {
      const g = m.groups[0];
      naver.state.adgroups.find((x) => x.nccAdgroupId === g.naverId).useExpSearch = true;
      const row = await client.adGroup.findUniqueOrThrow({ where: { id: g.id } });
      const r = await lock('adgroup', g.id, { locked: false, expected_lock_version: row.lockVersion });
      assert.deepEqual([r.status, r.body.error.code, r.body.error.field], [409, 'drift', 'useExpSearch']);
      assert.equal(puts(/^\/ncc\/adgroups\//).filter((c) => c.body.userLock === false).length, 0);
    });

    await t.test('IDOR, bad input and the seam is never reachable from the route', async () => {
      const row = await kwRow();
      env.session.user = 'other';
      let r = await lock('keyword', row.id, { locked: true, expected_lock_version: row.lockVersion });
      assert.equal(r.status, 404);
      env.session.user = 'owner';
      for (const [type, body] of [['bogus', { locked: true, expected_lock_version: 0 }], ['keyword', { locked: 'no', expected_lock_version: 0 }],
        ['keyword', { locked: true, expected_lock_version: -1 }], ['keyword', { locked: true, expected_lock_version: 0, extra: 1 }], ['keyword', { locked: true, expected_updated_at: 'x' }]]) {
        r = await lock(type, row.id, body);
        assert.ok([400, 404].includes(r.status), `${type} ${JSON.stringify(body)} → ${r.status}`);
      }
      const root = path.resolve(__dirname, '../../..');
      const src = ['app/api/ads/entities/[type]/[id]/lock/route.ts', 'app/api/ads/proposals/[id]/apply/route.ts'].map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
      assert.doesNotMatch(src, /afterLock|now:/);
    });
  } finally {
    delete process.env.ADS_EXECUTION_ENABLED;
    await env.close();
  }
});
