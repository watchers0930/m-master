/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process, Response */
// 해제 견고성 — 실DB(PGlite) + 가짜 네이버 (적대 검토 I-1·I-2):
// - I-1: 해제 시작 시 조건부 전이 active|invalid_key → disconnecting. 진행 중 다른 작업자의 새 클라이언트는 거부되고, 동시 재개(프로브 C)는
//        최종 전체 재조회에서 잡혀 중단(키 유지·상태 복원). 동시 해제 2건은 하나만 진행.
// - I-2: 모든 페이지를 baseSearchId 커서로 읽는다(서버가 요청보다 작게 잘라도). 미러 naverId가 읽은 집합에 없으면 확인 실패(프로브 D).
//        꺼짐 = userLock===true 또는 status==='DELETED'.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupAdsDb, request } = require('./fixtures/ads-db.cjs');
const { fakeNaver } = require('./fixtures/fake-naver.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;
const CID = '1234567';
const KEY = '0100000000aaaaaaaabbbbbbbbccccccccdddd1a2b', SECRET_KEY = 'AQAAAADsecretvalueSECRETVALUE9z8y==';
const cmp = (i) => `cmp-a001-01-${String(i).padStart(15, '0')}`;

test('ads account disconnect robustness on a real database', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async (t) => {
  const env = await setupAdsDb(packageDir);
  try {
    const { db } = env;
    const naver = fakeNaver();
    naver.state.keys.set(CID, { apiKey: KEY, secretKey: SECRET_KEY });
    env.useFetch(naver.fn);
    const { clientForAccount, clientForDisconnect, NaverAdsError } = require('../../external/naver-searchad.ts');
    const notConnected = (e) => e instanceof NaverAdsError && e.reason === 'ads_not_connected';
    const list = require('../../../app/api/ads/accounts/route.ts');
    const one = require('../../../app/api/ads/accounts/[id]/route.ts');
    const row = async () => (await db.query('SELECT * FROM ad_accounts')).rows[0];
    const send = async (fn) => { const res = await fn(); return { status: res.status, body: await res.json() }; };
    const del = (id) => send(() => one.DELETE(request('DELETE', `/api/ads/accounts/${id}`), { params: Promise.resolve({ id }) }));
    const connect = () => send(() => list.POST(request('POST', '/api/ads/accounts', { customerId: CID, apiKey: KEY, secretKey: SECRET_KEY, label: '베스트라' })));
    const reset = async (n, { on = true, mirror = 0 } = {}) => {
      naver.state.campaigns = Array.from({ length: n }, (_, i) => ({ nccCampaignId: cmp(i + 1), name: `mq-p${i + 1}`, userLock: !on, status: 'ELIGIBLE' }));
      Object.assign(naver.state, { pageCap: undefined, ignoreCursor: false, hooks: {} });
      naver.state.ignorePause.clear();
      await db.exec(`DELETE FROM ad_campaigns`);
      for (let i = 1; i <= mirror; i++)
        await db.exec(`INSERT INTO ad_campaigns(id,owner_id,ad_account_id,naver_id,name,user_lock,locked_by,updated_at) VALUES ('m${i}','owner','${id}','${cmp(i)}','mq-p${i}',false,'guard',now())`);
      if ((await row()).status === 'disabled') assert.equal((await connect()).status, 201);
      naver.state.calls.length = 0;
    };
    assert.equal((await connect()).status, 201);
    const id = (await row()).id;

    await t.test('probe C: concurrent resume during disconnect is caught by the final full re-read; other writers are refused', async () => {
      await reset(2, { mirror: 2 });
      const seen = [];
      let midAccount; // 해제 중 행을 제품과 같은 경로(Prisma, camelCase·실제 봉인 키)로 읽는다. 단언은 훅 밖에서(훅 안 예외는 전송 오류로 삼켜짐)
      naver.state.hooks.before = async (c) => {
        if (c.method !== 'PUT' || midAccount) return;
        midAccount = await env.client.adAccount.findUnique({ where: { id } });
        seen.push(midAccount.status, (await db.query(`SELECT locked_by FROM ad_campaigns ORDER BY id`)).rows.map((r) => r.locked_by).join(','));
      };
      // 마지막 끄기 PUT 직후, 이미 꺼둔 첫 캠페인을 다른 작업자(⓪ 이전에 클라이언트를 만든 가드 자동 재개)가 다시 켬
      naver.state.hooks.after = (c) => { if (c.method === 'PUT' && c.path.endsWith(cmp(2))) naver.state.campaigns[0].userLock = false; };
      const r = await del(id);
      assert.notEqual(r.status, 200);
      assert.equal(r.body.error.code, 'disconnect_incomplete');
      assert.deepEqual(seen.slice(0, 2), ['disconnecting', 'owner,owner'], '0단계에서 disconnecting + 미러 owner 잠금');
      // 거부 원인은 오직 status: 키는 실제 봉인 blob(non-null)이고, 같은 객체를 active로 바꾸면 만들어진다(양성 대조)
      assert.equal(midAccount.status, 'disconnecting');
      assert.match(midAccount.apiKeyEnc, /^v1:/);
      assert.match(midAccount.secretKeyEnc, /^v1:/);
      assert.throws(() => clientForAccount(midAccount), notConnected, '해제 중 다른 작업자의 새 클라이언트 거부');
      assert.equal(clientForAccount({ ...midAccount, status: 'active' }).toJSON().customerId, CID, '같은 객체 + active = 생성됨');
      // 해제 전용 클라이언트는 그 반대: disconnecting만 허용, active 거부
      assert.equal(clientForDisconnect(midAccount).toJSON().customerId, CID);
      assert.throws(() => clientForDisconnect({ ...midAccount, status: 'active' }), notConnected);
      for (const st of ['invalid_key', 'disabled']) {
        assert.throws(() => clientForAccount({ ...midAccount, status: st }), notConnected, st);
        assert.throws(() => clientForDisconnect({ ...midAccount, status: st }), notConnected, st);
      }
      const after = await row();
      assert.equal(after.status, 'active', '중단하면 이전 상태로 복원 — 가드가 계속 감시');
      assert.ok(after.api_key_enc && after.secret_key_enc, '키 유지');
    });

    await t.test('concurrent second disconnect while one is in progress gets 409 and sends nothing', async () => {
      await reset(1);
      let second, started = false;
      naver.state.hooks.before = async (c) => {
        if (c.method !== 'PUT' || started) return;
        started = true;
        const n = naver.state.calls.length;
        second = await del(id);
        second.calls = naver.state.calls.length - n;
      };
      const first = await del(id);
      assert.equal(first.status, 200);
      assert.equal(second.status, 409);
      assert.equal(second.body.error.code, 'disconnect_in_progress');
      assert.equal(second.calls, 0, '두 번째 해제는 네이버 호출 0');
      assert.equal(naver.count('PUT', /.*/), 1, '끄기 PUT 1회');
    });

    await t.test('probe D: server truncates at 100 and ignores the cursor → unconfirmed, abort with keys kept', async () => {
      await reset(150, { mirror: 150 });
      Object.assign(naver.state, { pageCap: 100, ignoreCursor: true });
      const r = await del(id);
      assert.equal(r.status, 502);
      assert.equal(r.body.error.code, 'disconnect_incomplete');
      assert.ok(r.body.error.unconfirmedCampaigns >= 50, String(r.body.error.unconfirmedCampaigns));
      const after = await row();
      assert.equal(after.status, 'active');
      assert.ok(after.api_key_enc);
    });

    await t.test('probe D without mirror rows: a non-advancing cursor alone is unconfirmed (no mirror to cross-check)', async () => {
      await reset(150);
      Object.assign(naver.state, { pageCap: 100, ignoreCursor: true });
      const r = await del(id);
      assert.equal(r.status, 502);
      assert.equal((await row()).status, 'active');
      assert.ok((await row()).api_key_enc);
    });

    await t.test('reconnect during disconnect: final key deletion is conditional on still disconnecting', async () => {
      await reset(1);
      let reconnected;
      naver.state.hooks.after = async (c) => { if (c.method === 'PUT' && !reconnected) reconnected = await connect(); };
      const r = await del(id);
      assert.equal(reconnected.status, 201);
      assert.equal(r.status, 409);
      assert.equal(r.body.error.code, 'disconnect_in_progress');
      const after = await row();
      assert.deepEqual([after.status, Boolean(after.api_key_enc)], ['active', true], '재연결한 키를 지우지 않는다');
    });

    await t.test('multi-page: all pages are read via baseSearchId cursor (server pages of 100) and every campaign is paused', async () => {
      await reset(250, { mirror: 3 });
      naver.state.pageCap = 100;
      const r = await del(id);
      assert.equal(r.status, 200);
      assert.ok(naver.state.campaigns.every((c) => c.userLock === true), '250개 전부 꺼짐');
      assert.equal(naver.count('PUT', /.*/), 250);
      const gets = naver.state.calls.filter((c) => c.method === 'GET' && c.path === '/ncc/campaigns');
      assert.ok(gets.length >= 6, `두 번(처음·최종) 모두 전 페이지 — ${gets.length}`);
      assert.deepEqual(gets[0].query, { recordSize: '1000' });
      assert.deepEqual(gets[1].query, { recordSize: '1000', baseSearchId: cmp(100), selector: 'NEXT' });
      assert.equal((await row()).status, 'disabled');
    });

    await t.test('DELETED campaigns count as off; a mirror campaign missing from Naver is unconfirmed', async () => {
      await reset(2, { mirror: 2 });
      naver.state.campaigns[1].status = 'DELETED'; // 켜진 채(userLock=false) 삭제됨 → 과금 없음
      naver.state.campaigns.push({ nccCampaignId: cmp(9), userLock: true, status: 'PAUSED' });
      await db.exec(`INSERT INTO ad_campaigns(id,owner_id,ad_account_id,naver_id,name,user_lock,updated_at) VALUES ('ghost','owner','${id}','${cmp(77)}','mq-ghost',false,now())`);
      let r = await del(id);
      assert.deepEqual(naver.state.calls.filter((c) => c.method === 'PUT').map((c) => c.path), [`/ncc/campaigns/${cmp(1)}`], 'DELETED·PAUSED엔 PUT 없음');
      assert.equal(r.status, 502, '미러에 있는데 네이버 목록에 없는 캠페인 = 확인 못 함');
      assert.equal(r.body.error.unconfirmedCampaigns, 1);
      assert.equal((await row()).status, 'active');
      await db.exec(`DELETE FROM ad_campaigns WHERE id='ghost'`);
      naver.state.calls.length = 0;
      r = await del(id);
      assert.equal(r.status, 200);
      assert.equal(naver.count('PUT', /.*/), 0, '이미 꺼진 것만 남음 → 재시도는 PUT 0');
      assert.equal((await row()).status, 'disabled');
    });

    // ── 멈춘 'disconnecting'(프로세스 사망) 회수: updatedAt이 10분보다 오래된 행만 재점유, 젊은 행은 409 ──
    const MIN = 60_000;
    // Prisma는 timestamp(3)에 UTC를 쓴다 → SQL now()(세션 시간대) 대신 JS에서 UTC 값을 만든다
    const utc = (ms) => new Date(Date.now() - ms).toISOString().replace('T', ' ').replace('Z', '');
    const stuck = async (from, ageMs) => db.exec(`UPDATE ad_accounts SET status='disconnecting', disconnect_from_status='${from}', updated_at='${utc(ageMs)}'`);
    const { disconnectAccount } = require('../disconnect.ts');
    const at = (ms) => () => new Date(Date.now() + ms);

    await t.test('stuck disconnecting: a stale row is taken over and the disconnect finishes', async () => {
      await reset(2, { mirror: 2 });
      await stuck('active', 11 * MIN);
      const r = await del(id);
      assert.equal(r.status, 200);
      assert.ok(naver.state.campaigns.every((c) => c.userLock));
      const after = await row();
      assert.deepEqual([after.status, after.api_key_enc, after.disconnect_from_status], ['disabled', null, null]);
    });

    await t.test('stuck disconnecting: a fresh row (< 10 min, injectable clock) gets 409 and sends nothing', async () => {
      await reset(1);
      await stuck('active', 0);
      await assert.rejects(disconnectAccount('owner', id, { transport: naver.fn, now: at(9 * MIN) }), (e) => e.status === 409 && e.code === 'disconnect_in_progress');
      assert.equal(naver.state.calls.length, 0);
      assert.equal((await del(id)).status, 409, '라우트도 409');
      const done = await disconnectAccount('owner', id, { transport: naver.fn, now: at(11 * MIN) }); // 같은 행, 시계만 11분 뒤
      assert.equal(done.status, 'disabled');
    });

    await t.test('takeover then abort restores the original pre-disconnect status (invalid_key)', async () => {
      await reset(1);
      await stuck('invalid_key', 30 * MIN);
      naver.state.hooks.before = (c) => (c.method === 'PUT' ? new Response('{}', { status: 500 }) : undefined);
      const r = await del(id);
      assert.equal(r.status, 502);
      const after = await row();
      assert.deepEqual([after.status, Boolean(after.api_key_enc), after.disconnect_from_status], ['invalid_key', true, null], '재점유 후 중단 → 최초 상태로 복원');
      await db.exec(`UPDATE ad_accounts SET status='active'`);
    });

    await t.test('two concurrent takeovers of a stale row: exactly one wins', async () => {
      await reset(1);
      await stuck('active', 11 * MIN);
      const results = await Promise.all([del(id), del(id)]);
      assert.deepEqual(results.map((x) => x.status).sort(), [200, 409]);
      assert.equal(results.find((x) => x.status === 409).body.error.code, 'disconnect_in_progress');
      assert.equal(naver.count('PUT', /.*/), 1, '끄기 PUT 1회');
      assert.equal((await row()).status, 'disabled');
    });

    await t.test('first claim records the pre-disconnect status', async () => {
      await reset(1);
      await db.exec(`UPDATE ad_accounts SET status='invalid_key'`);
      let mid;
      naver.state.hooks.before = async () => { if (!mid) mid = await row(); return new Response('{}', { status: 503 }); };
      await del(id);
      assert.deepEqual([mid.status, mid.disconnect_from_status], ['disconnecting', 'invalid_key']);
      assert.deepEqual([(await row()).status, (await row()).disconnect_from_status], ['invalid_key', null]);
      await db.exec(`UPDATE ad_accounts SET status='active'`);
    });

    await t.test('invalid key during disconnect: abort, status becomes invalid_key, keys kept', async () => {
      await reset(1);
      naver.state.keys.set(CID, { apiKey: KEY, secretKey: 'AQAAAADrotatedonnaver==' });
      const r = await del(id);
      assert.equal(r.status, 409);
      assert.equal(r.body.error.code, 'ads_key_invalid');
      const after = await row();
      assert.equal(after.status, 'invalid_key', 'disconnecting에서 복원할 때 키 무효를 반영');
      assert.ok(after.api_key_enc);
      assert.equal((await db.query(`SELECT count(*)::int c FROM ad_alerts WHERE type='ads.key_invalid'`)).rows[0].c, 1);
      naver.state.keys.set(CID, { apiKey: KEY, secretKey: SECRET_KEY });
    });
  } finally {
    await env.close();
  }
});
