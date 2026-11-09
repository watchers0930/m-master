/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process, Buffer, console */
// GET /api/admin/credential-key: 플랫폼 오너만 {kid, anchorKid, writable, reason?}. 미로그인·타인 404, GET 외 메서드 전원 404,
// 내부 오류는 고정 본문 500(로그는 코드만). 비밀값 없음.
require('../../visibility/__tests__/register.cjs');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
let user = null, sessionFails = false, anchorRow = null, dbFails = false;
require.cache[require.resolve('../../auth.ts')] = { exports: { requireSession: async () => {
  if (sessionFails) throw new Error('session store down');
  if (!user) throw new Error('Unauthorized');
  return { user: { id: user } };
} } };
require.cache[require.resolve('../../channel-credentials.ts')] = { exports: { isPlatformOwner: async id => id === 'owner' } };
require.cache[require.resolve('../../prisma.ts')] = { exports: { prisma: { $queryRaw: async () => {
  if (dbFails) throw new Error('db down: postgresql://user:pw@host');
  return anchorRow ? [{ kid: anchorRow }] : [];
} } } };
const { credentialKeyId } = require('../../crypto/credentials.ts');
const { resetAnchorCache } = require('../anchor.ts');
const route = require('../../../app/api/admin/credential-key/route.ts');
const SECRET = Buffer.alloc(32, 7).toString('base64');
const OTHER = Buffer.alloc(32, 9).toString('base64');
beforeEach(() => { process.env.CREDENTIAL_ENCRYPTION_SECRET = SECRET; anchorRow = null; dbFails = false; sessionFails = false; resetAnchorCache(); });
const call = async (method = 'GET') => { const res = await route[method](); return { status: res.status, body: await res.json(), cache: res.headers.get('cache-control') }; };

test('non-owner and anonymous get 404 without revealing anything', async () => {
  anchorRow = credentialKeyId();
  for (const who of [null, 'tenant']) {
    user = who;
    const r = await call();
    assert.equal(r.status, 404);
    assert.ok(!JSON.stringify(r.body).includes(credentialKeyId()));
  }
});

test('non-GET methods are 404 for everyone, including the owner', async () => {
  for (const who of [null, 'tenant', 'owner']) {
    user = who;
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal((await call(method)).status, 404);
  }
});

test('platform owner gets runtime kid, anchor kid and writability; never secret material', async () => {
  user = 'owner';
  const kid = credentialKeyId();
  let r = await call();
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { kid, anchorKid: null, writable: false, reason: 'not_configured' }, '앵커 생성 전');
  assert.equal(r.cache, 'no-store');
  anchorRow = kid; resetAnchorCache();
  assert.deepEqual((await call()).body, { kid, anchorKid: kid, writable: true });
  process.env.CREDENTIAL_ENCRYPTION_SECRET = OTHER;
  r = await call();
  assert.deepEqual(r.body, { kid: credentialKeyId(), anchorKid: kid, writable: false, reason: 'key_mismatch' });
  delete process.env.CREDENTIAL_ENCRYPTION_SECRET;
  r = await call();
  assert.deepEqual(r.body, { kid: null, anchorKid: kid, writable: false, reason: 'not_configured' });
  for (const s of [SECRET, OTHER]) assert.equal(JSON.stringify(r.body).includes(s), false);
});

test('internal failures are a fixed 500, distinct from 404, with a code-only log', async () => {
  const logs = []; const original = console.error; console.error = (...a) => logs.push(a);
  try {
    user = 'owner'; dbFails = true;
    let r = await call();
    assert.deepEqual([r.status, r.body.error.code], [500, 'internal_error']);
    dbFails = false; sessionFails = true;
    r = await call();
    assert.deepEqual([r.status, r.body.error.code], [500, 'internal_error'], '세션 저장소 장애는 404로 숨기지 않는다');
  } finally { console.error = original; }
  assert.deepEqual(logs, [['[credentials] key status failed', { code: 'internal_error' }], ['[credentials] key status failed', { code: 'internal_error' }]]);
  assert.ok(!JSON.stringify(logs).includes('postgresql://'));
});

test('OPTIONS is 404 for everyone and leaks no Allow header', async () => {
  for (const who of [null, 'tenant', 'owner']) {
    user = who;
    assert.equal(typeof route.OPTIONS, 'function', 'OPTIONS를 직접 export해야 Next가 자동 Allow 응답을 만들지 않는다');
    const res = await route.OPTIONS();
    assert.equal(res.status, 404);
    assert.equal(res.headers.get('allow'), null);
  }
});
