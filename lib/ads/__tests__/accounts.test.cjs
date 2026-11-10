/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process, Request */
// 광고 계정 접근 제어·입력 검증(DB 없음): 허용목록 밖은 모든 메서드 404(DB·네이버 접근 0), 미로그인 401, 교차 출처 변이 거부,
// zod strict 입력(고객ID 숫자·키 ASCII 인쇄문자+길이 상한·라벨 상한·알 수 없는 키 거부).
require('../../visibility/__tests__/register.cjs');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
let user = 'outsider';
const touched = [];
require.cache[require.resolve('../../auth.ts')] = { exports: { requireSession: async () => {
  if (!user) throw new Error('Unauthorized');
  return { user: { id: user } };
} } };
// DB에 닿으면 기록만 하고 실패시킨다 — 허용목록 밖 요청은 DB에 닿지 않아야 한다
const trap = new Proxy({}, { get: (_t, model) => new Proxy({}, { get: (_m, op) => async () => { touched.push(`${String(model)}.${String(op)}`); throw new Error('db touched'); } }) });
require.cache[require.resolve('../../prisma.ts')] = { exports: { prisma: trap } };
const { isAdsOwner, assertAdsOwner } = require('../access.ts');
const { VisibilityError } = require('../../visibility/errors.ts');
const schemas = require('../../../schemas/ads.ts');
const list = require('../../../app/api/ads/accounts/route.ts');
const one = require('../../../app/api/ads/accounts/[id]/route.ts');

const KEY = '0100000000abcdefghijklmnopqrstuvwxyz0123456789', SECRET_KEY = 'AQAAAABsecretSECRETsecret==';
const req = (method, url, body, headers = { origin: 'http://localhost' }) =>
  new Request(`http://localhost${url}`, { method, headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
const params = (id) => ({ params: Promise.resolve({ id }) });
const calls = () => [
  ['GET list', () => list.GET(req('GET', '/api/ads/accounts'))],
  ['POST connect', () => list.POST(req('POST', '/api/ads/accounts', { customerId: '1234567', apiKey: KEY, secretKey: SECRET_KEY, label: 'x' }))],
  ['GET one', () => one.GET(req('GET', '/api/ads/accounts/acc1'), params('acc1'))],
  ['PATCH one', () => one.PATCH(req('PATCH', '/api/ads/accounts/acc1', { action: 'select_channel', channelId: 'bsn-a001-00-000000015361946' }), params('acc1'))],
  ['DELETE one', () => one.DELETE(req('DELETE', '/api/ads/accounts/acc1'), params('acc1'))],
];
beforeEach(() => { process.env.ADS_OWNER_IDS = 'owner, admin-2'; touched.length = 0; globalThis.fetch = async () => { throw new Error('network touched'); }; });

test('allowlist parsing: comma separated, trimmed, exact match, empty or missing env allows nobody', () => {
  assert.equal(isAdsOwner('owner'), true);
  assert.equal(isAdsOwner('admin-2'), true);
  for (const v of ['own', 'owner ', 'OWNER', '', ' ', undefined, null, 1]) assert.equal(isAdsOwner(v), false, String(v));
  process.env.ADS_OWNER_IDS = ' , ,';
  assert.equal(isAdsOwner(''), false);
  delete process.env.ADS_OWNER_IDS;
  assert.equal(isAdsOwner('owner'), false);
  assert.throws(() => assertAdsOwner('owner'), (e) => e instanceof VisibilityError && e.status === 404 && e.code === 'not_found');
});

test('non-allowlisted owner gets 404 on every ads route without touching the DB or Naver', async () => {
  for (const who of ['outsider', 'owner-but-not-listed']) {
    user = who;
    for (const [name, call] of calls()) {
      const res = await call();
      assert.equal(res.status, 404, `${who} ${name}`);
      assert.deepEqual((await res.json()).error.code, 'not_found');
    }
  }
  assert.deepEqual(touched, []);
});

test('anonymous gets 401; cross-origin mutation is rejected before any work', async () => {
  user = null;
  for (const [name, call] of calls()) assert.equal((await call()).status, 401, name);
  user = 'owner';
  const evil = { origin: 'https://evil.test' };
  assert.equal((await list.POST(req('POST', '/api/ads/accounts', { customerId: '1' }, evil))).status, 403);
  assert.equal((await one.DELETE(req('DELETE', '/api/ads/accounts/acc1', undefined, evil), params('acc1'))).status, 403);
  assert.equal((await one.DELETE(req('DELETE', '/api/ads/accounts/acc1', undefined, {}), params('acc1'))).status, 403, 'Origin 없음 = 출처 증명 없음');
  assert.deepEqual(touched, []);
});

test('connect input: numeric customerId, printable-ASCII keys with length caps, capped label, strict keys', () => {
  const ok = { customerId: '1234567', apiKey: KEY, secretKey: SECRET_KEY, label: '베스트라 광고' };
  assert.deepEqual(schemas.adsConnectSchema.parse(ok), ok);
  const bad = {
    'customerId letters': { customerId: '12a4' }, 'customerId leading zero': { customerId: '0123' }, 'customerId number type': { customerId: 1234567 },
    'customerId too long': { customerId: '1'.repeat(16) }, 'customerId empty': { customerId: '' },
    'apiKey space': { apiKey: 'abc def ghi jkl mno' }, 'apiKey newline': { apiKey: KEY + '\n' }, 'apiKey non-ascii': { apiKey: KEY + 'é' },
    'apiKey too short': { apiKey: 'short' }, 'apiKey too long': { apiKey: 'a'.repeat(257) }, 'secretKey too long': { secretKey: 'a'.repeat(257) },
    'secretKey control char': { secretKey: SECRET_KEY + '\u0007' },
    'label empty': { label: '  ' }, 'label too long': { label: '가'.repeat(51) }, 'label control char': { label: 'a\u0000b' },
    'unknown key': { status: 'active' }, 'ownerId injection': { ownerId: 'other' },
  };
  for (const [name, patch] of Object.entries(bad)) assert.equal(schemas.adsConnectSchema.safeParse({ ...ok, ...patch }).success, false, name);
});

test('patch input: discriminated replace_keys / select_channel, strict, channel id format', () => {
  const p = schemas.adsAccountPatchSchema;
  assert.equal(p.safeParse({ action: 'replace_keys', apiKey: KEY, secretKey: SECRET_KEY }).success, true);
  assert.equal(p.safeParse({ action: 'select_channel', channelId: 'bsn-a001-00-000000015361946' }).success, true);
  for (const bad of [
    {}, { action: 'enable' }, { action: 'replace_keys', apiKey: KEY }, { action: 'replace_keys', apiKey: KEY, secretKey: SECRET_KEY, customerId: '1' },
    { action: 'select_channel', channelId: '../ncc/campaigns' }, { action: 'select_channel', channelId: 'a/b' }, { action: 'select_channel', channelId: 'x'.repeat(65) },
    { action: 'select_channel', channelId: 'bsn-1', status: 'active' },
  ]) assert.equal(p.safeParse(bad).success, false, JSON.stringify(bad));
  assert.equal(schemas.adsAccountIdSchema.safeParse('acc1').success, true);
  for (const bad of ['', 'a/b', '../x', 'x'.repeat(65)]) assert.equal(schemas.adsAccountIdSchema.safeParse(bad).success, false, bad);
});

test('allowlisted owner with a malformed body or id gets 400 without touching Naver', async () => {
  user = 'owner';
  assert.equal((await list.POST(req('POST', '/api/ads/accounts', { customerId: 'abc', apiKey: KEY, secretKey: SECRET_KEY, label: 'x' }))).status, 400);
  assert.equal((await one.PATCH(req('PATCH', '/api/ads/accounts/acc1', { action: 'nope' }), params('acc1'))).status, 400);
  assert.equal((await one.GET(req('GET', '/api/ads/accounts/a%2Fb'), params('a/b'))).status, 404, '형식이 틀린 id는 존재하지 않는 것과 같다');
  assert.deepEqual(touched, []);
});
