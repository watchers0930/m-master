/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 광고 계정 연결 — 실DB(PGlite) + 가짜 네이버: 키 검증 전 저장 0, 봉인 blob만 저장, 응답엔 keyLast4만, 같은 고객ID 재연결 멱등
// (공유예산은 만들지 않음 — 기존 mq-cap만 검증 후 재사용, 핫픽스 2026-11-11), 키 교체는 검증 통과 후에만, 다른 소유자 id는 404(IDOR), 저장 키 장애는 503(무효 키로 위장하지 않음).
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupAdsDb, request } = require('./fixtures/ads-db.cjs');
const { fakeNaver } = require('./fixtures/fake-naver.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;
const CID = '1234567';
const KEY = '0100000000aaaaaaaabbbbbbbbccccccccdddd1a2b', SECRET_KEY = 'AQAAAADsecretvalueSECRETVALUE9z8y==';
const KEY2 = '0100000000eeeeeeeeffffffffgggggggghhhh3c4d', SECRET_KEY2 = 'AQAAAADrotatedSECRETrotated7x6w==';
const SITE = { nccBusinessChannelId: 'bsn-a001-00-000000015361946', channelTp: 'SITE', name: '베스트라', channelKey: 'https://vestra.ai.kr', pcInspectStatus: 'UNDER_REVIEW', mobileInspectStatus: 'UNDER_REVIEW', status: 'PAUSED' };

test('ads account connect on a real database', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async (t) => {
  const env = await setupAdsDb(packageDir);
  try {
    const { db, session } = env;
    const naver = fakeNaver();
    naver.state.keys.set(CID, { apiKey: KEY, secretKey: SECRET_KEY });
    naver.state.channels.push(SITE, { ...SITE, nccBusinessChannelId: 'bsn-phone-1', channelTp: 'PHONE' });
    env.useFetch(naver.fn);
    const { decryptSecret } = require('../../crypto/credentials.ts');
    const { adCredentialContext } = require('../../external/naver-searchad.ts');
    const accounts = require('../accounts.ts');
    const list = require('../../../app/api/ads/accounts/route.ts');
    const one = require('../../../app/api/ads/accounts/[id]/route.ts');
    const rows = async () => (await db.query('SELECT * FROM ad_accounts ORDER BY created_at')).rows;
    // 모든 응답 JSON을 스캔: 키 원문·DB 암호문·blob 접두어·키/암호문 필드명이 절대 없어야 한다
    const scanned = [];
    const call = async (fn) => {
      const res = await fn();
      const text = await res.text();
      const dbBlobs = (await rows()).flatMap((r) => [r.api_key_enc, r.secret_key_enc]).filter(Boolean);
      for (const needle of [KEY, SECRET_KEY, KEY2, SECRET_KEY2, ...dbBlobs, 'v1:', 'apiKeyEnc', 'secretKeyEnc', 'api_key_enc', '"secretKey"', '"apiKey"'])
        assert.equal(text.includes(needle), false, `response leaks ${needle.slice(0, 12)}…`);
      scanned.push(res.status);
      return { status: res.status, body: JSON.parse(text), cache: res.headers.get('cache-control') };
    };
    const connect = (body) => call(() => list.POST(request('POST', '/api/ads/accounts', body)));
    const input = { customerId: CID, apiKey: KEY, secretKey: SECRET_KEY, label: '베스트라 광고' };

    await t.test('connect rejects invalid key without storing', async () => {
      const r = await connect({ ...input, secretKey: 'AQAAAADwrongwrongwrongwrong==' });
      assert.equal(r.status, 400);
      assert.equal(r.body.error.code, 'ads_key_rejected');
      assert.deepEqual(await rows(), []);
      assert.equal(naver.count('POST', /.*/), 0, '검증 실패 시 변이 없음');
      assert.deepEqual(naver.state.calls.map((c) => `${c.method} ${c.path}`), ['GET /ncc/campaigns']);
      assert.equal((await db.query('SELECT count(*)::int n FROM ad_operation_logs')).rows[0].n, 0);
      // 다른 고객ID(키는 맞지만 X-Customer가 다름)도 저장 없이 거부
      assert.equal((await connect({ ...input, customerId: '7654321' })).status, 400);
      assert.deepEqual(await rows(), []);
    });

    await t.test('connect stores only ciphertext and returns masked key', async () => {
      naver.state.calls.length = 0;
      const r = await connect(input);
      assert.equal(r.status, 201);
      assert.equal(r.cache, 'no-store');
      const [row] = await rows();
      assert.equal(row.owner_id, 'owner');
      assert.equal(row.status, 'active');
      assert.equal(row.key_last4, KEY.slice(-4));
      for (const blob of [row.api_key_enc, row.secret_key_enc]) {
        assert.match(blob, /^v1:[0-9a-f]{16}:/);
        assert.equal(blob.includes(KEY) || blob.includes(SECRET_KEY), false);
      }
      assert.equal(decryptSecret(row.api_key_enc, adCredentialContext('api_key', 'owner', CID)), KEY);
      assert.equal(decryptSecret(row.secret_key_enc, adCredentialContext('secret_key', 'owner', CID)), SECRET_KEY);
      assert.throws(() => decryptSecret(row.api_key_enc, adCredentialContext('api_key', 'other', CID)), '다른 소유자 context로는 열리지 않는다');
      const a = r.body.data.account;
      assert.deepEqual(Object.keys(a).sort(), ['businessChannelId', 'connected', 'createdAt', 'dailyCapKrw', 'disconnectStuck', 'id', 'keyLast4', 'label', 'lastVerifiedAt', 'maxBidKrw', 'naverCustomerId', 'sharedBudgetId', 'sharedBudgetKrw', 'status']);
      assert.equal(a.keyLast4, KEY.slice(-4));
      assert.equal(a.connected, true);
      // 공유예산(핫픽스 2026-11-11): 연결은 만들지 않는다 — 네이버는 캠페인 없는 생성을 400/1002로 거부했다(실운영). 첫 적용이 캠페인과 함께 만든다
      // 하루 상한 [대장 결정 2026-11-11] 1만 원: DB 기본값(100000)이 아니라 코드 상수로 명시 저장 → caps() 통과
      const { caps, DAILY_CAP_CEILING_KRW } = require('../invariants.ts');
      assert.deepEqual([row.daily_cap_krw, row.shared_budget_krw, DAILY_CAP_CEILING_KRW], [10000, 10000, 10000]);
      assert.deepEqual(caps({ dailyCapKrw: row.daily_cap_krw, sharedBudgetKrw: row.shared_budget_krw, maxBidKrw: row.max_bid_krw }), { dailyCapKrw: 10000, budget: 10000, maxBid: 2000 });
      assert.equal(a.dailyCapKrw, 10000);
      assert.equal(naver.count('POST', /.*/), 0, '연결은 네이버에 아무것도 만들지 않는다');
      assert.equal(a.sharedBudgetId, null);
      assert.equal(row.shared_budget_id, null);
      assert.equal(naver.state.sharedBudgets.length, 0);
      assert.equal((await db.query('SELECT count(*)::int n FROM ad_operation_logs')).rows[0].n, 0, '변이 원장 0');
      // 채널: SITE만, 검수 중이면 선택 불가로 표시
      assert.deepEqual(r.body.data.channels, [{ id: SITE.nccBusinessChannelId, name: '베스트라', url: 'https://vestra.ai.kr', pcInspectStatus: 'UNDER_REVIEW', mobileInspectStatus: 'UNDER_REVIEW', selectable: false }]);
      assert.equal(naver.state.calls.find((c) => c.path === '/ncc/channels').query.channelTp, 'SITE');
    });

    await t.test('connect is idempotent for same customerId and reuses only a safe existing mq-cap', async () => {
      const before = (await rows())[0];
      naver.state.calls.length = 0;
      const r = await connect({ ...input, label: '베스트라 광고 2' });
      assert.equal(r.status, 201);
      const after = await rows();
      assert.equal(after.length, 1, '중복 행 없음');
      assert.equal(after[0].id, before.id);
      assert.equal(after[0].label, '베스트라 광고 2');
      assert.equal(naver.count('POST', /.*/), 0, '공유예산을 만들지 않는다');
      assert.equal(r.body.data.account.sharedBudgetId, null);
      // 재연결(같은 행 update)도 상한을 상수로 다시 쓴다 — 옛 10만 원 행이 남지 않게
      await db.exec(`UPDATE ad_accounts SET daily_cap_krw = 100000, shared_budget_krw = 100000`);
      assert.equal((await connect(input)).status, 201);
      assert.deepEqual([(await rows())[0].daily_cap_krw, (await rows())[0].shared_budget_krw], [10000, 10000]);
      // 이미 있는 mq-cap(캠페인 유형, 상한 이하)은 재조회·검증 후 그 id를 쓴다(예: 이전 적용이 만들었는데 DB 기록이 지워짐)
      const mq = { sharedBudgetId: 'sbg-a001-00-000000000001', customerId: 1234567, name: 'mq-cap', ownerType: 'CAMPAIGN', deliveryMethod: 'ACCELERATED', dailyBudget: 10000, status: 'ELIGIBLE', numberInUse: 1 };
      naver.state.sharedBudgets.push({ ...mq, sharedBudgetId: 'sbg-other-1', name: '다른 예산' }, mq);
      naver.state.calls.length = 0;
      const reused = await connect(input);
      assert.equal(reused.status, 201);
      assert.equal(reused.body.data.account.sharedBudgetId, mq.sharedBudgetId);
      assert.equal((await rows())[0].shared_budget_id, mq.sharedBudgetId);
      assert.ok(naver.state.calls.some((c) => c.method === 'GET' && c.path === `/ncc/shared-budgets/${mq.sharedBudgetId}`), '재사용 전 단건 재조회');
      assert.equal(naver.count('POST', /.*/), 0);
      // 상한을 넘게 바뀐 mq-cap은 재사용을 거부한다(조용히 쓰지 않음), 이름이 둘이면 고르지 않는다
      await db.exec(`UPDATE ad_accounts SET shared_budget_id = NULL`);
      mq.dailyBudget = 50000; naver.state.sharedBudgets[1].dailyBudget = 50000;
      const unsafe = await connect(input);
      assert.deepEqual([unsafe.status, unsafe.body.error.code, unsafe.body.error.field], [409, 'shared_budget_unsafe', 'dailyBudget']);
      naver.state.sharedBudgets[1].dailyBudget = 10000;
      naver.state.sharedBudgets.push({ ...naver.state.sharedBudgets[1], sharedBudgetId: 'sbg-dup-2' });
      const dup = await connect(input);
      assert.deepEqual([dup.status, dup.body.error.code], [409, 'shared_budget_ambiguous']);
      // DELETED는 재사용하지 않는다 → 다시 null로 연결(첫 적용이 만든다)
      naver.state.sharedBudgets.forEach((b) => { b.status = 'DELETED'; });
      const gone = await connect(input);
      assert.deepEqual([gone.status, gone.body.data.account.sharedBudgetId], [201, null]);
      assert.equal(naver.count('POST', /.*/), 0, '어떤 경우에도 연결은 POST하지 않는다');
      naver.state.sharedBudgets.length = 0;
    });

    await t.test('key replacement swaps keys only after the new key passes validation', async () => {
      await connect(input);
      const id = (await rows())[0].id;
      const before = (await rows())[0];
      const patch = (body, who = 'owner') => { session.user = who; return call(() => one.PATCH(request('PATCH', `/api/ads/accounts/${id}`, body), { params: Promise.resolve({ id }) })); };
      let r = await patch({ action: 'replace_keys', apiKey: KEY2, secretKey: SECRET_KEY2 });
      assert.equal(r.status, 400, '네이버에 아직 등록 안 된 새 키');
      assert.equal(r.body.error.code, 'ads_key_rejected');
      const kept = (await rows())[0];
      assert.deepEqual([kept.api_key_enc, kept.secret_key_enc, kept.key_last4, kept.status], [before.api_key_enc, before.secret_key_enc, before.key_last4, 'active']);
      naver.state.keys.set(CID, { apiKey: KEY2, secretKey: SECRET_KEY2 }); // 대장이 네이버에서 재발급
      await db.exec(`UPDATE ad_accounts SET status = 'invalid_key'`);
      r = await patch({ action: 'replace_keys', apiKey: KEY2, secretKey: SECRET_KEY2 });
      assert.equal(r.status, 200);
      assert.equal(r.body.data.keyLast4, KEY2.slice(-4));
      const swapped = (await rows())[0];
      assert.equal(swapped.status, 'active', '무효 키 상태에서 새 키로 복구');
      assert.equal(decryptSecret(swapped.secret_key_enc, adCredentialContext('secret_key', 'owner', CID)), SECRET_KEY2);
      // IDOR: 허용목록에 있는 다른 소유자도 남의 계정 id로는 404, 아무것도 바뀌지 않음
      naver.state.calls.length = 0;
      r = await patch({ action: 'replace_keys', apiKey: KEY, secretKey: SECRET_KEY }, 'other');
      assert.equal(r.status, 404);
      for (const fn of [() => one.GET(request('GET', `/api/ads/accounts/${id}`), { params: Promise.resolve({ id }) }),
        () => one.DELETE(request('DELETE', `/api/ads/accounts/${id}`), { params: Promise.resolve({ id }) })]) assert.equal((await call(fn)).status, 404);
      assert.equal(naver.state.calls.length, 0, '남의 계정으로 네이버 호출 0');
      assert.deepEqual((await call(() => list.GET(request('GET', '/api/ads/accounts')))).body.data, [], '목록도 자기 것만');
      session.user = 'owner';
      assert.equal(decryptSecret((await rows())[0].api_key_enc, adCredentialContext('api_key', 'owner', CID)), KEY2);
      naver.state.keys.set(CID, { apiKey: KEY, secretKey: SECRET_KEY });
      // 검증 중에 다른 요청이 해제를 끝냈다 → 키를 되살리지 않는다(해제 불변식: disabled ⇒ 키 null)
      naver.state.hooks.before = async (c) => { if (c.path === '/ncc/campaigns') await db.exec(`UPDATE ad_accounts SET status='disabled', api_key_enc=NULL, secret_key_enc=NULL, key_last4=NULL`); };
      r = await patch({ action: 'replace_keys', apiKey: KEY, secretKey: SECRET_KEY });
      naver.state.hooks.before = undefined;
      assert.equal(r.status, 409);
      assert.deepEqual([(await rows())[0].status, (await rows())[0].api_key_enc], ['disabled', null]);
      assert.equal((await connect(input)).status, 201, '재연결로 복구');
      assert.equal((await patch({ action: 'replace_keys', apiKey: KEY, secretKey: SECRET_KEY })).status, 200);
    });

    await t.test('credential storage failure is 503 (not an invalid-key result) and stores nothing', async () => {
      const { CredentialCryptoError } = require('../../crypto/credentials.ts');
      await db.exec(`DELETE FROM ad_operation_logs; DELETE FROM ad_accounts`);
      await db.exec(`DELETE FROM credential_key_anchor`); env.anchor.resetAnchorCache();
      naver.state.calls.length = 0;
      const r = await connect(input);
      assert.equal(r.status, 503);
      assert.equal(r.body.error.code, 'credential_storage_unavailable');
      assert.deepEqual(await rows(), []);
      assert.equal(naver.state.calls.length, 0, '저장할 수 없으면 네이버에 키를 보내지도 않는다');
      await assert.rejects(accounts.connectAccount('owner', input), (e) => e instanceof CredentialCryptoError && e.reason === 'not_configured');
      await db.exec(`INSERT INTO credential_key_anchor(id,kid) VALUES ('default','${require('../../crypto/credentials.ts').credentialKeyId()}')`); env.anchor.resetAnchorCache();
      assert.equal((await connect(input)).status, 201);
    });

    await t.test('list returns only DTO fields for own accounts', async () => {
      const r = await call(() => list.GET(request('GET', '/api/ads/accounts')));
      assert.equal(r.status, 200);
      assert.equal(r.body.data.length, 1);
      assert.equal(r.body.data[0].keyLast4, KEY.slice(-4));
      assert.ok(scanned.length >= 15, `scanned ${scanned.length} responses`);
    });
  } finally {
    await env.close();
  }
});
