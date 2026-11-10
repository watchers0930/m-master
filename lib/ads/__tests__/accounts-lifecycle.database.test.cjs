/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 광고 계정 수명주기 — 실DB(PGlite) + 가짜 네이버: 비즈채널 선택(PC·모바일 모두 승인일 때만, 서버 재확인), 무효 키 → invalid_key + 알림 1회
// + 이후 호출 0, 해제 = 모든 캠페인 끄기 → 재조회 확인 → 키 삭제(확인 실패 시 키 유지·중단), 미러·성과 보존, 재연결은 같은 행 재활성.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupAdsDb, request } = require('./fixtures/ads-db.cjs');
const { fakeNaver, json } = require('./fixtures/fake-naver.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;
const CID = '1234567';
const KEY = '0100000000aaaaaaaabbbbbbbbccccccccdddd1a2b', SECRET_KEY = 'AQAAAADsecretvalueSECRETVALUE9z8y==';
const CH = 'bsn-a001-00-000000015361946';
const SITE = { nccBusinessChannelId: CH, channelTp: 'SITE', name: '베스트라', channelKey: 'https://vestra.ai.kr', pcInspectStatus: 'UNDER_REVIEW', mobileInspectStatus: 'UNDER_REVIEW', status: 'PAUSED' };

test('ads account lifecycle on a real database', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async (t) => {
  const env = await setupAdsDb(packageDir);
  try {
    const { db } = env;
    const naver = fakeNaver();
    naver.state.keys.set(CID, { apiKey: KEY, secretKey: SECRET_KEY });
    naver.state.channels.push({ ...SITE });
    env.useFetch(naver.fn);
    const accounts = require('../accounts.ts');
    const list = require('../../../app/api/ads/accounts/route.ts');
    const one = require('../../../app/api/ads/accounts/[id]/route.ts');
    const row = async () => (await db.query('SELECT * FROM ad_accounts')).rows[0];
    const send = async (fn) => { const res = await fn(); return { status: res.status, body: await res.json() }; };
    const at = (id) => ({ params: Promise.resolve({ id }) });
    const patch = (id, body) => send(() => one.PATCH(request('PATCH', `/api/ads/accounts/${id}`, body), at(id)));
    const del = (id) => send(() => one.DELETE(request('DELETE', `/api/ads/accounts/${id}`), at(id)));
    const connect = () => send(() => list.POST(request('POST', '/api/ads/accounts', { customerId: CID, apiKey: KEY, secretKey: SECRET_KEY, label: '베스트라' })));
    assert.equal((await connect()).status, 201);
    const id = (await row()).id;

    await t.test('channel under review cannot be selected; server re-checks at selection time', async () => {
      let r = await patch(id, { action: 'select_channel', channelId: CH });
      assert.equal(r.status, 409);
      assert.equal(r.body.error.code, 'channel_not_approved');
      assert.equal(r.body.error.pcInspectStatus, 'UNDER_REVIEW');
      assert.equal((await row()).business_channel_id, null);
      naver.state.channels[0].pcInspectStatus = 'APPROVED'; // PC만 승인
      assert.equal((await patch(id, { action: 'select_channel', channelId: CH })).status, 409, '모바일 검수 중이면 거부');
      for (const s of [['APPROVED', 'DENIED'], ['PENDING', 'ELIGIBLE']]) {
        Object.assign(naver.state.channels[0], { pcInspectStatus: s[0], mobileInspectStatus: s[1] });
        assert.equal((await patch(id, { action: 'select_channel', channelId: CH })).status, 409, s.join('/'));
      }
      assert.equal((await patch(id, { action: 'select_channel', channelId: 'bsn-unknown-1' })).status, 422, '없는 채널은 네이버 거절(404→rejected)');
      Object.assign(naver.state.channels[0], { pcInspectStatus: 'APPROVED', mobileInspectStatus: 'ELIGIBLE' });
      // 응답 id가 요청과 다르거나 SITE가 아니면 저장하지 않는다
      naver.state.hooks.after = (c) => (c.path === `/ncc/channels/${CH}` ? json(200, { ...SITE, pcInspectStatus: 'APPROVED', mobileInspectStatus: 'APPROVED', channelTp: 'PHONE' }) : undefined);
      assert.equal((await patch(id, { action: 'select_channel', channelId: CH })).status, 409);
      naver.state.hooks.after = (c) => (c.path === `/ncc/channels/${CH}` ? json(200, { ...SITE, nccBusinessChannelId: 'bsn-other-2', pcInspectStatus: 'APPROVED', mobileInspectStatus: 'APPROVED' }) : undefined);
      assert.equal((await patch(id, { action: 'select_channel', channelId: CH })).status, 409, '요청과 다른 채널이 오면 저장하지 않는다');
      naver.state.hooks.after = (c) => (c.path === `/ncc/channels/${CH}` ? json(200, { unexpected: true }) : undefined);
      assert.equal((await patch(id, { action: 'select_channel', channelId: CH })).status, 502, '형태가 다른 조회 응답은 오류');
      naver.state.hooks.after = undefined;
      assert.equal((await row()).business_channel_id, null);
      r = await patch(id, { action: 'select_channel', channelId: CH });
      assert.equal(r.status, 200);
      assert.equal(r.body.data.businessChannelId, CH);
      assert.equal((await row()).business_channel_id, CH);
      const detail = await send(() => one.GET(request('GET', `/api/ads/accounts/${id}`), at(id)));
      assert.equal(detail.body.data.channels[0].selectable, true);
    });

    await t.test('invalid key marks account and stops calls', async () => {
      naver.state.keys.set(CID, { apiKey: KEY, secretKey: 'AQAAAADnoticerotated==' }); // 네이버 쪽에서 비밀키가 바뀜(2026-07 공지)
      naver.state.calls.length = 0;
      let r = await patch(id, { action: 'select_channel', channelId: CH });
      assert.equal(r.status, 409);
      assert.equal(r.body.error.code, 'ads_key_invalid');
      assert.equal((await row()).status, 'invalid_key');
      assert.ok((await row()).api_key_enc, '무효여도 키는 그대로(교체로 복구) — disabled가 아니면 키 non-null');
      const alerts = (await db.query(`SELECT owner_id,ad_account_id,type FROM ad_alerts`)).rows;
      assert.deepEqual(alerts, [{ owner_id: 'owner', ad_account_id: id, type: 'ads.key_invalid' }]);
      const n = naver.state.calls.length;
      assert.equal(n, 1);
      // 이후 모든 경로가 네이버를 부르지 않는다
      r = await patch(id, { action: 'select_channel', channelId: CH });
      assert.equal(r.status, 409);
      assert.equal(r.body.error.code, 'ads_not_connected');
      const detail = await send(() => one.GET(request('GET', `/api/ads/accounts/${id}`), at(id)));
      assert.equal(detail.status, 200);
      assert.deepEqual(detail.body.data.channels, []);
      assert.equal(detail.body.data.account.status, 'invalid_key');
      r = await del(id);
      assert.equal(r.status, 409, '키가 무효면 캠페인을 끌 수 없으므로 해제(키 삭제)도 하지 않는다');
      assert.equal(r.body.error.code, 'ads_key_invalid');
      assert.equal(await accounts.markInvalidKey(id), false, '이미 무효 — 다시 바꾸지 않음');
      assert.equal(naver.state.calls.length, n, '무효 계정 호출 0');
      assert.equal((await db.query(`SELECT count(*)::int c FROM ad_alerts`)).rows[0].c, 1, '알림 1회');
      naver.state.keys.set(CID, { apiKey: KEY, secretKey: SECRET_KEY });
      assert.equal((await patch(id, { action: 'replace_keys', apiKey: KEY, secretKey: SECRET_KEY })).status, 200);
      assert.equal((await row()).status, 'active');
    });

    await t.test('disconnect locks campaigns before deleting keys', async () => {
      naver.state.campaigns.push(
        { nccCampaignId: 'cmp-a001-01-000000000000001', name: 'mq-p1', userLock: false, customerId: 1234567 },
        { nccCampaignId: 'cmp-a001-01-000000000000002', name: '수동 캠페인', userLock: true, customerId: 1234567 },
        { nccCampaignId: 'cmp-a001-01-000000000000003', name: 'mq-p2', userLock: false, customerId: 1234567 },
      );
      await db.exec(`INSERT INTO ad_campaigns(id,owner_id,ad_account_id,naver_id,name,user_lock,locked_by,updated_at) VALUES ('m1','owner','${id}','cmp-a001-01-000000000000001','mq-p1',false,NULL,now())`);
      await db.exec(`INSERT INTO ad_performance_daily(id,owner_id,ad_account_id,entity_type,naver_id,date,imp_cnt,clk_cnt,cost_krw) VALUES ('p1','owner','${id}','campaign','cmp-a001-01-000000000000001','2026-11-09',10,1,500)`);
      // 1) 끄기 PUT은 성공했다고 답했지만 실제로는 하나가 안 꺼짐 → 재조회에서 잡혀 중단, 키 유지
      naver.state.ignorePause.add('cmp-a001-01-000000000000003');
      let r = await del(id);
      assert.equal(r.status, 502);
      assert.equal(r.body.error.code, 'disconnect_incomplete');
      assert.equal(r.body.error.unconfirmedCampaigns, 1);
      assert.equal((await row()).status, 'active');
      assert.ok((await row()).api_key_enc && (await row()).secret_key_enc);
      // 2) PUT 실패(5xx=uncertain)도 중단·키 유지
      naver.state.ignorePause.clear();
      naver.state.campaigns[2].userLock = false;
      naver.state.hooks.before = (c) => (c.method === 'PUT' ? json(500, {}) : undefined);
      r = await del(id);
      naver.state.hooks.before = undefined;
      assert.equal(r.status, 502);
      assert.ok((await row()).api_key_enc);
      // 2b) 재조회 목록이 recordSize 상한(1000)만큼 차면 잘렸을 수 있다 → 확인 실패로 중단
      naver.state.hooks.before = undefined;
      naver.state.hooks.after = (c) => (c.method === 'GET' && c.path === '/ncc/campaigns' && naver.state.campaigns.every((x) => x.userLock)
        ? json(200, Array.from({ length: 1000 }, (_, i) => ({ nccCampaignId: `cmp-x-${i}`, userLock: true }))) : undefined);
      r = await del(id);
      naver.state.hooks.after = undefined;
      assert.equal(r.status, 502);
      assert.ok((await row()).api_key_enc);
      naver.state.campaigns[2].userLock = false;
      // 3) 정상: PUT(?fields=userLock, 최소 본문)이 키 삭제보다 먼저, 이미 꺼진 캠페인엔 PUT 없음, 재조회 후 키 삭제
      naver.state.calls.length = 0;
      const keyAtPut = [];
      naver.state.hooks.before = async (c) => { if (c.method === 'PUT') keyAtPut.push(Boolean((await row()).api_key_enc)); };
      r = await del(id);
      naver.state.hooks.before = undefined;
      assert.equal(r.status, 200);
      const puts = naver.state.calls.filter((c) => c.method === 'PUT');
      assert.deepEqual(puts.map((c) => [c.path, c.query, c.body]), [
        ['/ncc/campaigns/cmp-a001-01-000000000000003', { fields: 'userLock' }, { nccCampaignId: 'cmp-a001-01-000000000000003', userLock: true }],
      ]);
      assert.deepEqual(keyAtPut, [true], '끄는 동안 키는 아직 있다');
      const seq = naver.state.calls.map((c) => `${c.method} ${c.path}`);
      assert.equal(seq.at(-1), 'GET /ncc/campaigns', '마지막 호출 = 재조회');
      assert.ok(naver.state.campaigns.every((c) => c.userLock === true));
      const after = await row();
      assert.deepEqual([after.status, after.api_key_enc, after.secret_key_enc, after.key_last4], ['disabled', null, null, null]);
      assert.equal(after.shared_budget_id !== null && after.business_channel_id === CH, true, '공유예산·채널 기록은 재연결을 위해 보존');
      assert.equal(r.body.data.connected, false);
      // 미러·성과 보존, 미러는 꺼짐 + owner 잠금(재연결 후 가드 자동 재개 대상 아님)
      assert.deepEqual((await db.query(`SELECT user_lock,locked_by FROM ad_campaigns`)).rows, [{ user_lock: true, locked_by: 'owner' }]);
      assert.equal((await db.query(`SELECT count(*)::int c FROM ad_performance_daily`)).rows[0].c, 1);
      const ops = (await db.query(`SELECT step,method,path,status FROM ad_operation_logs WHERE step='campaign.pause' ORDER BY created_at`)).rows;
      assert.ok(ops.length >= 3 && ops.some((o) => o.status === 'uncertain') && ops.at(-1).status === 'ok', JSON.stringify(ops));
      // 해제된 계정: 다시 해제는 멱등(네이버 호출 0), 키 교체·채널 선택은 연결 안 됨
      naver.state.calls.length = 0;
      assert.equal((await del(id)).status, 200);
      assert.equal((await patch(id, { action: 'replace_keys', apiKey: KEY, secretKey: SECRET_KEY })).status, 409);
      assert.equal((await patch(id, { action: 'select_channel', channelId: CH })).status, 409);
      assert.equal(naver.state.calls.length, 0);
      const listed = await send(() => list.GET(request('GET', '/api/ads/accounts')));
      assert.deepEqual([listed.body.data[0].status, listed.body.data[0].connected, listed.body.data[0].keyLast4], ['disabled', false, null], '연결 안 됨(오류 아님)');
    });

    await t.test('reconnecting the same customer reactivates the disabled row without a new shared budget', async () => {
      const before = await row();
      naver.state.calls.length = 0;
      const r = await connect();
      assert.equal(r.status, 201);
      const all = (await db.query('SELECT id,status,shared_budget_id FROM ad_accounts')).rows;
      assert.deepEqual(all, [{ id: before.id, status: 'active', shared_budget_id: before.shared_budget_id }]);
      assert.equal(naver.count('POST', /.*/), 0);
      assert.ok((await row()).api_key_enc);
    });
  } finally {
    await env.close();
  }
});
