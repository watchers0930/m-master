/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process, Buffer, console */
// GA4 owner_oauth 자격증명은 저장소(복호화)를 거쳐 읽는다. 복호화 실패는 invalid_credentials로 드러나고 값 없이 로그만 남는다.
require('../../visibility/__tests__/register.cjs');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const SECRET = Buffer.alloc(32, 7).toString('base64');
let row = null;
require.cache[require.resolve('../../prisma.ts')] = { exports: { prisma: { channelCredential: { findUnique: async () => row && { ...row } } } } };
const built = [];
require.cache[require.resolve('google-auth-library')] = { exports: { UserRefreshClient: class { constructor(id, secret, refresh) { built.push({ id, secret, refresh }); } } } };
require.cache[require.resolve('@google-analytics/data')] = { exports: { BetaAnalyticsDataClient: class { constructor(options) { this.options = options; } } } };
const { encryptSecret } = require('../../crypto/credentials.ts');
const { credentialCandidates, invalidateGa4Credentials } = require('../auth.ts');
const { Ga4Failure } = require('../errors.ts');
const scope = { ownerId: 'owner-1', bindingId: 'b1', allowedSources: ['owner_oauth'] };

beforeEach(() => { process.env.CREDENTIAL_ENCRYPTION_SECRET = SECRET; built.length = 0; invalidateGa4Credentials('owner-1'); });

test('ga4 auth reads owner_oauth through store', async () => {
  row = { accessToken: null, refreshToken: encryptSecret('refresh-plain', 'channel_credentials.refresh_token:owner-1:ga4'), expiresAt: null,
    meta: { client_id: 'gcid', client_secret: encryptSecret('secret-plain', 'channel_credentials.meta.client_secret:owner-1:ga4') }, updatedAt: new Date(1) };
  const [candidate] = await credentialCandidates(scope);
  assert.equal(candidate.source, 'owner_oauth');
  candidate.client();
  assert.deepEqual(built, [{ id: 'gcid', secret: 'secret-plain', refresh: 'refresh-plain' }]);
});

test('ga4 owner_oauth decrypt failure surfaces as invalid_credentials and logs no values', async () => {
  row = { accessToken: null, refreshToken: encryptSecret('refresh-plain', 'channel_credentials.refresh_token:someone-else:ga4'), expiresAt: null,
    meta: { client_id: 'gcid', client_secret: 'legacy' }, updatedAt: new Date(2) };
  const original = console.error, logged = [];
  console.error = (...args) => logged.push(args);
  try {
    const [candidate] = await credentialCandidates(scope);
    assert.equal(candidate.source, 'owner_oauth');
    assert.throws(() => candidate.client(), e => e instanceof Ga4Failure && e.code === 'invalid_credentials');
  } finally { console.error = original; }
  assert.deepEqual(logged, [['[credentials] decrypt failed', { channel: 'ga4', reason: 'invalid_blob' }]]);
  assert.deepEqual(built, []);
});
