/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process, Buffer, Response, AbortSignal, AbortController, DOMException */
// 네이버 검색광고 클라이언트: 서명·헤더·GET만 재시도·상태 분류·비밀값 비노출·계정 복호화 경계.
// 네트워크는 절대 타지 않는다(주입 transport). 실제 네이버 키는 쓰지 않는다.
require('../../visibility/__tests__/register.cjs');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto'), util = require('node:util');

require.cache[require.resolve('../../prisma.ts')] = { exports: { prisma: { $queryRaw: async () => [{ kid: require('../../crypto/credentials.ts').credentialKeyId() }] } } };
const { CredentialCryptoError } = require('../../crypto/credentials.ts');
const { sealForStorage } = require('../../credentials/seal.ts');
const { resetAnchorCache } = require('../../credentials/anchor.ts');
const { signature, NaverAdsClient, NaverAdsError, clientForAccount, adCredentialContext } = require('../../external/naver-searchad.ts');

const SECRET = 'TEST-secret-zz9-DO-NOT-LEAK';
const API_KEY = 'TEST-apikey-qq7-DO-NOT-LEAK';
const CREDS = { customerId: '1234567', apiKey: API_KEY, secretKey: SECRET };
const ENC_SECRET = Buffer.alloc(32, 7).toString('base64');
beforeEach(() => { process.env.CREDENTIAL_ENCRYPTION_SECRET = ENC_SECRET; resetAnchorCache(); });

const hmac = (secret, msg) => crypto.createHmac('sha256', secret).update(msg).digest('base64');
const json = (status, body, headers = {}) => new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
// 응답 큐를 순서대로 돌려주고 호출을 기록한다. 함수 항목은 throw(네트워크 오류) 용도.
function fake(...queue) {
  const calls = [];
  const transport = async (url, init) => {
    calls.push({ url: String(url), init });
    const next = queue.shift();
    if (!next) throw new Error('unexpected extra call');
    if (typeof next === 'function') return next();
    return next;
  };
  return { transport, calls };
}
// 가짜 시계: sleep은 시간을 즉시 전진시키고, 시도별 타임아웃 요청값을 기록한다.
function clock() {
  const c = { start: 1731200000000, sleeps: [], timeouts: [] };
  c.t = c.start;
  c.now = () => c.t;
  c.sleep = async ms => { c.sleeps.push(ms); c.t += ms; };
  c.timeout = ms => { c.timeouts.push(ms); return new AbortController().signal; };
  c.hang = () => () => { c.t += c.timeouts.at(-1); throw new DOMException('timed out', 'TimeoutError'); }; // 타임아웃까지 응답 없음
  return c;
}
const netErr = () => () => { throw new TypeError('fetch failed'); };
const reason = (r, extra = {}) => e => {
  assert.ok(e instanceof NaverAdsError, `NaverAdsError expected, got ${e && e.name}`);
  assert.equal(e.reason, r);
  for (const [k, v] of Object.entries(extra)) assert.equal(e[k], v, k);
  return true;
};

test('signature matches independent HMAC (query stripped from the signed path)', () => {
  const ts = '1731200000000';
  assert.equal(signature(ts, 'GET', '/ncc/campaigns', SECRET), hmac(SECRET, `${ts}.GET./ncc/campaigns`));
  assert.equal(signature(ts, 'GET', '/ncc/campaigns?recordSize=10&x=1', SECRET), hmac(SECRET, `${ts}.GET./ncc/campaigns`));
  assert.equal(signature(ts, 'put', '/ncc/adgroups/grp-1', SECRET), hmac(SECRET, `${ts}.PUT./ncc/adgroups/grp-1`));
});

test('adCredentialContext pins the exact AAD string', () => {
  assert.equal(adCredentialContext('api_key', 'owner1', '1234567'), 'ad_accounts.api_key:owner1:1234567');
  assert.equal(adCredentialContext('secret_key', 'owner1', '1234567'), 'ad_accounts.secret_key:owner1:1234567');
});

test('headers carry X-Customer per account and a verifiable signature', async () => {
  for (const customerId of ['1111111', '2222222']) {
    const { transport, calls } = fake(json(200, [{ nccCampaignId: 'cmp-1' }]));
    const client = new NaverAdsClient({ ...CREDS, customerId }, transport);
    const out = await client.get('/ncc/campaigns', { recordSize: 10, baseSearchId: undefined });
    assert.deepEqual(out, [{ nccCampaignId: 'cmp-1' }]);
    const { url, init } = calls[0];
    assert.equal(url, 'https://api.searchad.naver.com/ncc/campaigns?recordSize=10');
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(init.body, undefined);
    const h = init.headers;
    assert.equal(h['X-Customer'], customerId);
    assert.equal(h['X-API-KEY'], API_KEY);
    assert.match(h['X-Timestamp'], /^\d{13}$/);
    assert.equal(h['X-Signature'], hmac(SECRET, `${h['X-Timestamp']}.GET./ncc/campaigns`));
    assert.equal(h['Content-Type'], undefined, 'GET has no body content-type');
  }
});

test('POST/PUT send JSON body with charset content-type and sign the bare path', async () => {
  const { transport, calls } = fake(json(200, { nccAdgroupId: 'grp-1' }), json(200, { ok: true }));
  const client = new NaverAdsClient(CREDS, transport);
  await client.post('/ncc/adgroups', { name: 'mq-p1-g1' });
  await client.put('/ncc/adgroups/grp-1', { userLock: true }, { fields: 'userLock' });
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.body, JSON.stringify({ name: 'mq-p1-g1' }));
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json; charset=UTF-8');
  assert.equal(calls[1].url, 'https://api.searchad.naver.com/ncc/adgroups/grp-1?fields=userLock');
  const h = calls[1].init.headers;
  assert.equal(h['X-Signature'], hmac(SECRET, `${h['X-Timestamp']}.PUT./ncc/adgroups/grp-1`));
});

test('GET retries 3 times on 5xx then ads_unavailable', async () => {
  const { transport, calls } = fake(json(500, {}), json(502, {}), json(503, { code: 9999 }));
  await assert.rejects(new NaverAdsClient(CREDS, transport, clock()).get('/ncc/campaigns'), reason('ads_unavailable', { status: 503 }));
  assert.equal(calls.length, 3);
  const ok = fake(json(503, {}), json(200, []));
  assert.deepEqual(await new NaverAdsClient(CREDS, ok.transport, clock()).get('/ncc/campaigns'), []);
  assert.equal(ok.calls.length, 2);
  const net = fake(() => { throw new TypeError('fetch failed'); }, () => { throw new TypeError('fetch failed'); }, () => { throw new TypeError('fetch failed'); });
  await assert.rejects(new NaverAdsClient(CREDS, net.transport, clock()).get('/ncc/campaigns'), reason('ads_unavailable'));
  assert.equal(net.calls.length, 3);
});

test('GET 429 / code 1016 retries up to 3 attempts then ads_rate_limited', async () => {
  const ok = fake(json(429, { code: 1016 }, { 'retry-after': '0' }), json(200, { ok: 1 }));
  assert.deepEqual([await new NaverAdsClient(CREDS, ok.transport, clock()).get('/stats'), ok.calls.length], [{ ok: 1 }, 2]);
  const always = fake(...[0, 1, 2].map(() => json(429, {}, { 'retry-after': '0' })));
  await assert.rejects(new NaverAdsClient(CREDS, always.transport, clock()).get('/stats'), reason('ads_rate_limited', { status: 429 }));
  assert.equal(always.calls.length, 3);
});

test('POST never retried; network error → ads_uncertain', async () => {
  for (const method of ['post', 'put']) {
    const net = fake(() => { throw new TypeError('fetch failed'); });
    await assert.rejects(new NaverAdsClient(CREDS, net.transport)[method]('/ncc/keywords', [{ keyword: 'k' }]), reason('ads_uncertain'));
    assert.equal(net.calls.length, 1);
    const five = fake(json(503, {}));
    await assert.rejects(new NaverAdsClient(CREDS, five.transport)[method]('/ncc/keywords', []), reason('ads_uncertain', { status: 503 }));
    assert.equal(five.calls.length, 1);
    const limited = fake(json(429, {}, { 'retry-after': '0' }));
    await assert.rejects(new NaverAdsClient(CREDS, limited.transport)[method]('/ncc/keywords', []), reason('ads_rate_limited', { status: 429 }));
    assert.equal(limited.calls.length, 1, 'mutation is never replayed, even on 429');
    const badJson = fake(new Response('<html>', { status: 200 }));
    await assert.rejects(new NaverAdsClient(CREDS, badJson.transport)[method]('/ncc/keywords', []), reason('ads_uncertain'));
  }
});

test('status classification table', async () => {
  const cases = [
    [json(401, { code: 1000 }), 'ads_auth_failed', 1000],
    [json(403, { type: 'https://api.searchad.naver.com/errors/invalid-signature', title: 'Invalid Signature', status: 403 }), 'ads_auth_failed', undefined],
    [json(403, { title: 'invalid-signature' }), 'ads_auth_failed', undefined],
    [json(403, { code: 1018, title: 'Not permitted' }), 'ads_forbidden', 1018],
    [json(403, { code: '1006' }), 'ads_forbidden', 1006],
    [json(429, { code: 1016 }), 'ads_rate_limited', 1016],
    [json(400, { code: 1016, title: 'too many requests' }), 'ads_rate_limited', 1016],
    [json(400, { code: 3906, title: 'keyword not allowed' }), 'ads_rejected', 3906],
    [json(404, {}), 'ads_rejected', undefined],
    [new Response('not json', { status: 400 }), 'ads_rejected', undefined],
    [json(500, { code: 5000 }), 'ads_uncertain', 5000],
  ];
  for (const [response, expected, naverCode] of cases) {
    const status = response.status;
    const { transport, calls } = fake(response);
    await assert.rejects(new NaverAdsClient(CREDS, transport).post('/ncc/keywords', []), reason(expected, { naverCode, status }), `${status} → ${expected}`);
    assert.equal(calls.length, 1);
  }
});

test('5xx outranks body codes: writes stay uncertain, GET retries then ads_unavailable', async () => {
  for (const [method, status, code] of [['put', 503, 1018], ['post', 500, 1016], ['post', 504, 1006]]) {
    const { transport, calls } = fake(json(status, { code }));
    await assert.rejects(new NaverAdsClient(CREDS, transport)[method]('/ncc/campaigns', {}), reason('ads_uncertain', { status, naverCode: code }));
    assert.equal(calls.length, 1);
  }
  const g = fake(...[0, 1, 2].map(() => json(503, { code: 1016 })));
  await assert.rejects(new NaverAdsClient(CREDS, g.transport, clock()).get('/stats'), reason('ads_unavailable', { status: 503, naverCode: 1016 }));
  assert.equal(g.calls.length, 3, 'GET 5xx retried');
});

test('GET 4xx (no special code) is answered once, never retried', async () => {
  for (const [res, r] of [[json(400, { code: 3906 }), 'ads_rejected'], [json(404, {}), 'ads_rejected'], [json(409, { code: 3506 }), 'ads_rejected'], [json(401, {}), 'ads_auth_failed'], [json(403, {}), 'ads_forbidden']]) {
    const c = clock(), { transport, calls } = fake(res, json(200, {}));
    await assert.rejects(new NaverAdsClient(CREDS, transport, c).get('/ncc/campaigns'), reason(r));
    assert.deepEqual([calls.length, c.sleeps], [1, []]);
  }
});

test('hanging GET: 25s per attempt, whole call ends within the 45s deadline after 2 attempts', async () => {
  const c = clock(), { transport, calls } = fake(c.hang(), c.hang(), c.hang());
  await assert.rejects(new NaverAdsClient(CREDS, transport, c).get('/stats'), reason('ads_unavailable'));
  assert.deepEqual([calls.length, c.timeouts[0]], [2, 25000]);
  assert.equal(c.timeouts[1], c.start + 45000 - (c.t - c.timeouts[1])); // 둘째 시도는 남은 시간만큼만
  assert.ok(c.t - c.start <= 45000, `elapsed ${c.t - c.start}`);
  assert.equal(c.sleeps.length, 1, 'no sleep that would overrun the deadline');
  const w = clock(), put = fake(w.hang(), json(200, {}));
  await assert.rejects(new NaverAdsClient(CREDS, put.transport, w).put('/ncc/campaigns/cmp-1', {}), reason('ads_uncertain'));
  assert.deepEqual([put.calls.length, w.timeouts], [1, [25000]]);
});

test('retries back off and re-sign with a fresh timestamp each attempt', async () => {
  for (const queue of [[json(503, {}), json(502, {}), json(200, [])], [netErr(), netErr(), json(200, [])]]) {
    const c = clock(), { transport, calls } = fake(...queue);
    assert.deepEqual(await new NaverAdsClient(CREDS, transport, c).get('/ncc/campaigns'), []);
    assert.equal(c.sleeps.length, 2);
    assert.ok(c.sleeps[0] >= 250 && c.sleeps[0] < 350 && c.sleeps[1] >= 500 && c.sleeps[1] < 600, `${c.sleeps}`);
    const stamps = calls.map(x => x.init.headers['X-Timestamp']);
    assert.equal(new Set(stamps).size, 3);
    for (const x of calls) assert.equal(x.init.headers['X-Signature'], hmac(SECRET, `${x.init.headers['X-Timestamp']}.GET./ncc/campaigns`));
  }
});

test('retry-after: ≤5s is waited, 6s fails fast without sleeping, negative never sleeps backwards', async () => {
  const fast = clock(), a = fake(json(429, {}, { 'retry-after': '6' }), json(200, {}));
  await assert.rejects(new NaverAdsClient(CREDS, a.transport, fast).get('/stats'), reason('ads_rate_limited'));
  assert.deepEqual([a.calls.length, fast.sleeps], [1, []]);
  const five = clock(), b = fake(json(429, {}, { 'retry-after': '5' }), json(200, { ok: 1 }));
  assert.deepEqual(await new NaverAdsClient(CREDS, b.transport, five).get('/stats'), { ok: 1 });
  assert.ok(b.calls.length === 2 && five.sleeps[0] >= 5000 && five.sleeps[0] < 5100, `${five.sleeps}`);
  const neg = clock(), n = fake(json(429, {}, { 'retry-after': '-5' }), json(200, {}));
  await new NaverAdsClient(CREDS, n.transport, neg).get('/stats');
  assert.ok(neg.sleeps.every(ms => ms >= 0), `${neg.sleeps}`);
});

test('constructor refuses malformed credentials (header-unsafe keys, non-numeric customer)', () => {
  for (const bad of [{ apiKey: API_KEY + '\n' }, { apiKey: 'a b' }, { secretKey: '' }, { secretKey: SECRET + '\r' }, { customerId: 'abc' }, { customerId: '' }]) {
    assert.throws(() => new NaverAdsClient({ ...CREDS, ...bad }, fake().transport), reason('ads_not_connected'));
  }
});

test('2xx bodies: empty → null, invalid JSON on GET → ads_unavailable', async () => {
  const empty = fake(new Response(null, { status: 200 }));
  assert.equal(await new NaverAdsClient(CREDS, empty.transport).put('/ncc/ads/ad-1', { userLock: true }), null);
  const bad = fake(new Response('<html>', { status: 200 }));
  await assert.rejects(new NaverAdsClient(CREDS, bad.transport).get('/ncc/campaigns'), reason('ads_unavailable'));
  assert.equal(bad.calls.length, 1);
});

test('unsafe paths are refused before any network call', async () => {
  const { transport, calls } = fake();
  const client = new NaverAdsClient(CREDS, transport);
  for (const p of ['ncc/campaigns', '//evil.example/x', '/ncc/../stats', '/ncc/campaigns?x=1', '/ncc/campaigns#f', '/ncc/ campaigns', 'https://evil.example/']) {
    await assert.rejects(client.get(p), /naver_ads_invalid_path/, p);
  }
  assert.equal(calls.length, 0);
});

test('secret never appears in error message or thrown object', async () => {
  const leaky = `boom ${SECRET} ${API_KEY}`;
  const scenarios = [
    () => fake(() => { throw new Error(leaky); }),
    () => fake(json(403, { title: leaky, type: 'invalid-signature', code: 1018 })),
    () => fake(json(400, { code: 3906, title: leaky, message: leaky })),
    () => fake(json(503, { title: leaky }), json(503, { title: leaky }), json(503, { title: leaky })),
    () => fake(new Response(leaky, { status: 200 })),
  ];
  for (const make of scenarios) {
    for (const method of ['get', 'post']) {
      const { transport } = make();
      const client = new NaverAdsClient(CREDS, transport, clock());
      let err;
      try { await (method === 'get' ? client.get('/ncc/campaigns') : client.post('/ncc/campaigns', {})); } catch (e) { err = e; }
      assert.ok(err instanceof NaverAdsError);
      assert.equal(err.cause, undefined);
      for (const view of [JSON.stringify(err), String(err), err.stack, util.inspect(err, { showHidden: true, depth: 5 }), err.message]) {
        assert.ok(!view.includes(SECRET) && !view.includes(API_KEY), `leak in ${view}`);
      }
    }
  }
  const inspected = util.inspect(new NaverAdsClient(CREDS, fake().transport), { depth: 5 }) + JSON.stringify(new NaverAdsClient(CREDS, fake().transport));
  assert.ok(!inspected.includes(SECRET) && !inspected.includes(API_KEY), 'client object hides credentials');
});

async function sealedAccount(overrides = {}) {
  const ownerId = 'owner1', naverCustomerId = '1234567';
  return {
    id: 'acc1', ownerId, naverCustomerId, status: 'active', keyLast4: 'LEAK',
    apiKeyEnc: await sealForStorage(API_KEY, adCredentialContext('api_key', ownerId, naverCustomerId)),
    secretKeyEnc: await sealForStorage(SECRET, adCredentialContext('secret_key', ownerId, naverCustomerId)),
    ...overrides,
  };
}

test('clientForAccount decrypts with per-account contexts and signs with the plain keys', async () => {
  const { transport, calls } = fake(json(200, []));
  await clientForAccount(await sealedAccount(), transport).get('/ncc/campaigns');
  const h = calls[0].init.headers;
  assert.equal(h['X-Customer'], '1234567');
  assert.equal(h['X-API-KEY'], API_KEY);
  assert.equal(h['X-Signature'], hmac(SECRET, `${h['X-Timestamp']}.GET./ncc/campaigns`));
});

test('clientForAccount: inactive or keyless account → ads_not_connected before decrypt or network', async () => {
  const { transport, calls } = fake();
  const garbage = { apiKeyEnc: 'not-a-blob', secretKeyEnc: 'not-a-blob' }; // 복호화를 시도하면 CredentialCryptoError가 난다
  for (const over of [{ status: 'invalid_key', ...garbage }, { status: 'disabled', ...garbage }, { status: 'pending', ...garbage }, { status: 'ACTIVE', ...garbage }, { status: undefined, ...garbage }, { apiKeyEnc: null, secretKeyEnc: 'not-a-blob' }, { secretKeyEnc: null, apiKeyEnc: 'not-a-blob' }]) {
    assert.throws(() => clientForAccount({ id: 'a', ownerId: 'o', naverCustomerId: '1', status: 'active', ...over }, transport), reason('ads_not_connected'));
  }
  assert.equal(calls.length, 0);
});

test('clientForAccount lets CredentialCryptoError propagate unchanged (never an ads_* reason)', async () => {
  const acc = await sealedAccount();
  // 다른 계정 context로 봉인된 blob(교차 사용) → AAD 불일치
  const swapped = { ...acc, apiKeyEnc: acc.secretKeyEnc };
  assert.throws(() => clientForAccount(swapped), e => e instanceof CredentialCryptoError && !(e instanceof NaverAdsError));
  assert.throws(() => clientForAccount({ ...acc, naverCustomerId: '7654321' }), e => e instanceof CredentialCryptoError);
  assert.throws(() => clientForAccount({ ...acc, apiKeyEnc: 'not-a-blob' }), e => e instanceof CredentialCryptoError && e.reason === 'invalid_blob');
  delete process.env.CREDENTIAL_ENCRYPTION_SECRET;
  assert.throws(() => clientForAccount(acc), e => e instanceof CredentialCryptoError && e.reason === 'not_configured');
});
