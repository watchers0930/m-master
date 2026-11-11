/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, Response */
// 광고 화면 API 래퍼(lib/api/ads.ts, Task 12) — 경로·메서드·본문이 서버 계약(schemas/ads*.ts strict)과 같고,
// 오류 본문 {error:{code,message,...details}}을 AdsApiError로 그대로 옮긴다. 키는 본문에만 싣는다(URL·오류에 없음).
require('../../visibility/__tests__/register.cjs');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const api = require('../ads.ts');

let calls = [], reply = () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
globalThis.fetch = async (url, init = {}) => { calls.push({ url, init, body: init.body === undefined ? undefined : JSON.parse(init.body) }); return reply(url, init); };
beforeEach(() => { calls = []; reply = () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }); });
const last = () => calls[calls.length - 1];

test('accounts: list, connect, replace keys, select channel, disconnect, overview', async () => {
  assert.deepEqual(await api.listAdAccounts(), { ok: true }, 'data 봉투를 벗긴다');
  assert.deepEqual([last().url, last().init.method ?? 'GET', last().init.cache], ['/api/ads/accounts', 'GET', 'no-store']);
  const input = { customerId: '1234567', apiKey: 'A'.repeat(20), secretKey: 'S'.repeat(20), label: '베스트라' };
  await api.connectAdAccount(input);
  assert.deepEqual([last().url, last().init.method, last().init.headers['Content-Type'], last().body], ['/api/ads/accounts', 'POST', 'application/json', input]);
  await api.replaceAdKeys('acc1', { apiKey: 'K'.repeat(20), secretKey: 'Z'.repeat(20) });
  assert.deepEqual([last().url, last().init.method, last().body], ['/api/ads/accounts/acc1', 'PATCH', { action: 'replace_keys', apiKey: 'K'.repeat(20), secretKey: 'Z'.repeat(20) }]);
  await api.selectAdChannel('acc1', 'bsn-1');
  assert.deepEqual([last().init.method, last().body], ['PATCH', { action: 'select_channel', channelId: 'bsn-1' }]);
  await api.disconnectAdAccount('acc1');
  assert.deepEqual([last().url, last().init.method, last().body], ['/api/ads/accounts/acc1', 'DELETE', undefined]);
  await api.getAdAccount('acc1');
  assert.deepEqual([last().url, last().init.method ?? 'GET'], ['/api/ads/accounts/acc1', 'GET']);
  await api.getAdOverview('a/b?c');
  assert.equal(last().url, '/api/ads/accounts/a%2Fb%3Fc/overview', 'id는 경로 인코딩');
});

test('proposals: list query, create, edit, review, apply; lock toggle', async () => {
  await api.listAdProposals({ take: 20, cursor: 'c1', status: 'approved', accountId: undefined });
  assert.equal(last().url, '/api/ads/proposals?take=20&cursor=c1&status=approved', '빈 값은 보내지 않는다(서버 strict)');
  await api.listAdProposals({});
  assert.equal(last().url, '/api/ads/proposals');
  const create = { accountId: 'acc1', kind: 'new_campaign', seeds: ['전세사기'] };
  await api.createAdProposal(create);
  assert.deepEqual([last().url, last().init.method, last().body], ['/api/ads/proposals', 'POST', create]);
  await api.getAdProposal('p1');
  assert.equal(last().url, '/api/ads/proposals/p1');
  const payload = { groups: [] };
  await api.editAdProposal('p1', '2026-11-10T00:00:00.000Z', payload);
  assert.deepEqual([last().init.method, last().body], ['PATCH', { expected_updated_at: '2026-11-10T00:00:00.000Z', payload }]);
  await api.reviewAdProposal('p1', 'approve', '2026-11-10T00:00:00.000Z');
  assert.deepEqual([last().url, last().body], ['/api/ads/proposals/p1/review', { decision: 'approve', expected_updated_at: '2026-11-10T00:00:00.000Z' }], 'reason 없으면 키도 없음');
  await api.reviewAdProposal('p1', 'reject', '2026-11-10T00:00:00.000Z', '  ');
  assert.deepEqual(last().body, { decision: 'reject', expected_updated_at: '2026-11-10T00:00:00.000Z' }, '빈 사유는 보내지 않는다');
  await api.reviewAdProposal('p1', 'reject', '2026-11-10T00:00:00.000Z', ' 키워드 부적합 ');
  assert.equal(last().body.reason, '키워드 부적합');
  await api.applyAdProposal('p1');
  assert.deepEqual([last().url, last().init.method, last().body], ['/api/ads/proposals/p1/apply', 'POST', undefined]);
  await api.setAdLock('keyword', 'k1', false, 7);
  assert.deepEqual([last().url, last().init.method, last().body], ['/api/ads/entities/keyword/k1/lock', 'POST', { locked: false, expected_lock_version: 7 }]);
});

test('errors keep server code, message, status and details; non-JSON and network failures are typed', async () => {
  reply = () => new Response(JSON.stringify({ error: { code: 'version_conflict', message: '다른 곳에서 제안이 바뀌었습니다.', updated_at: '2026-11-10T01:00:00.000Z' } }), { status: 409 });
  await assert.rejects(api.getAdProposal('p1'), (e) => {
    assert.ok(e instanceof api.AdsApiError);
    assert.deepEqual([e.status, e.code, e.message, e.details.updated_at], [409, 'version_conflict', '다른 곳에서 제안이 바뀌었습니다.', '2026-11-10T01:00:00.000Z']);
    assert.equal('code' in e.details || 'message' in e.details, false);
    return true;
  });
  reply = () => new Response('<html>bad gateway</html>', { status: 502 });
  await assert.rejects(api.listAdAccounts(), (e) => e instanceof api.AdsApiError && e.status === 502 && e.code === 'unknown' && e.message === '요청 실패 (HTTP 502)');
  reply = () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(api.listAdAccounts(), (e) => e instanceof api.AdsApiError && e.code === 'network' && e.status === 0);
  reply = () => new Response(JSON.stringify({ nope: 1 }), { status: 200 });
  await assert.rejects(api.listAdAccounts(), (e) => e instanceof api.AdsApiError && e.code === 'unknown', '200이라도 data 없으면 실패');
});

test('a key never appears in a URL or an error', async () => {
  const secret = 'SECRETSECRETSECRET1234';
  reply = () => new Response(JSON.stringify({ error: { code: 'ads_key_rejected', message: '네이버가 키를 거부했습니다.' } }), { status: 400 });
  await assert.rejects(api.connectAdAccount({ customerId: '1', apiKey: secret, secretKey: secret, label: 'x' }), (e) => !JSON.stringify({ m: e.message, d: e.details }).includes(secret));
  assert.equal(last().url.includes(secret), false);
});

test('a Naver error code in details is appended to the message (live 2026-11-11: 1002 had to be read from devtools)', async () => {
  reply = () => new Response(JSON.stringify({ error: { code: 'ads_rejected', message: '네이버가 요청을 거절했습니다.', naverCode: 1002 } }), { status: 422 });
  await assert.rejects(api.applyAdProposal('p1'), (e) => {
    assert.deepEqual([e.code, e.message, e.details.naverCode], ['ads_rejected', '네이버가 요청을 거절했습니다. (네이버 코드 1002)', 1002]);
    return true;
  });
  reply = () => new Response(JSON.stringify({ error: { code: 'ads_unavailable', naverCode: 5000 } }), { status: 503 });
  await assert.rejects(api.listAdAccounts(), (e) => e.message === '요청 실패 (HTTP 503) (네이버 코드 5000)');
  for (const naverCode of ['1002', 1.5, null, { x: 1 }, undefined]) {
    reply = () => new Response(JSON.stringify({ error: { code: 'ads_rejected', message: '거절', naverCode } }), { status: 422 });
    await assert.rejects(api.listAdAccounts(), (e) => e.message === '거절', `정수가 아니면 붙이지 않는다: ${JSON.stringify(naverCode)}`);
  }
});
