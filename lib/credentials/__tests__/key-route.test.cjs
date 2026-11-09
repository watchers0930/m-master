/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process, Buffer, console */
// GET /api/admin/credential-key: 플랫폼 오너만 kid·쓰기 가능 여부를 본다. 그 외(미로그인 포함)는 404. 비밀값 없음.
require('../../visibility/__tests__/register.cjs');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
let user = null;
require.cache[require.resolve('../../auth.ts')] = { exports: { requireSession: async () => { if (!user) throw new Error('Unauthorized'); return { user: { id: user } }; } } };
require.cache[require.resolve('../../channel-credentials.ts')] = { exports: { isPlatformOwner: async id => id === 'owner' } };
const { credentialKeyId } = require('../../crypto/credentials.ts');
const { GET } = require('../../../app/api/admin/credential-key/route.ts');
const SECRET = Buffer.alloc(32, 7).toString('base64');
const OTHER = Buffer.alloc(32, 9).toString('base64');
beforeEach(() => { process.env.CREDENTIAL_ENCRYPTION_SECRET = SECRET; process.env.CREDENTIAL_KEY_ID = credentialKeyId(); });
const call = async () => { const res = await GET(); return { status: res.status, body: await res.json(), cache: res.headers.get('cache-control') }; };

test('non-owner and anonymous get 404 without revealing anything', async () => {
  for (const who of [null, 'tenant']) {
    user = who;
    const r = await call();
    assert.equal(r.status, 404);
    assert.ok(!JSON.stringify(r.body).includes(credentialKeyId()));
  }
});

test('platform owner gets the running kid and writability; never secret material', async () => {
  user = 'owner';
  const logs = []; const original = console.error; console.error = (...a) => logs.push(a);
  try {
    const kid = credentialKeyId();
    let r = await call();
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { kid, writable: true });
    assert.equal(r.cache, 'no-store');
    delete process.env.CREDENTIAL_KEY_ID;
    r = await call();
    assert.deepEqual(r.body, { kid, writable: false, reason: 'not_configured' });
    process.env.CREDENTIAL_KEY_ID = kid; process.env.CREDENTIAL_ENCRYPTION_SECRET = OTHER;
    r = await call();
    assert.deepEqual(r.body, { kid: credentialKeyId(), writable: false, reason: 'key_mismatch' });
    assert.notEqual(r.body.kid, kid);
    delete process.env.CREDENTIAL_ENCRYPTION_SECRET;
    r = await call();
    assert.deepEqual(r.body, { kid: null, writable: false, reason: 'not_configured' });
    for (const text of [JSON.stringify(r.body), JSON.stringify(logs)]) for (const s of [SECRET, OTHER]) assert.equal(text.includes(s), false);
  } finally { console.error = original; }
});
