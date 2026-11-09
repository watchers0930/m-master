/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process, Buffer, console */
// 채널 자격증명 저장소: 비밀 필드만 암호화 저장, 평문(전환기)·암호문 이중 읽기, 복호화 실패는 throw.
require('../../visibility/__tests__/register.cjs');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const SECRET = Buffer.alloc(32, 7).toString('base64');
const OTHER = Buffer.alloc(32, 9).toString('base64');
let rows = new Map(), calls = [];
const key = (ownerId, channel) => ownerId + '|' + channel;
require.cache[require.resolve('../../prisma.ts')] = { exports: { prisma: { channelCredential: {
  findUnique: async ({ where }) => { calls.push('findUnique'); const r = rows.get(key(where.ownerId_channel.ownerId, where.ownerId_channel.channel)); return r ? { ...r } : null; },
  upsert: async (args) => { calls.push('upsert'); const w = args.where.ownerId_channel; const prev = rows.get(key(w.ownerId, w.channel));
    const next = prev ? { ...prev, ...args.update } : { ...args.create }; rows.set(key(w.ownerId, w.channel), next); return next; },
  deleteMany: async ({ where }) => { calls.push('deleteMany'); return { count: rows.delete(key(where.ownerId, where.channel)) ? 1 : 0 }; },
} } } };
const { encryptSecret, decryptSecret, CredentialCryptoError } = require('../../crypto/credentials.ts');
const store = require('../store.ts');

const ctx = (field, ownerId, channel) => `channel_credentials.${field}:${ownerId}:${channel}`;
beforeEach(() => { process.env.CREDENTIAL_ENCRYPTION_SECRET = SECRET; rows = new Map(); calls = []; });
function captureWarn(fn) {
  const original = console.warn, logged = [];
  console.warn = (...args) => logged.push(args);
  return Promise.resolve().then(fn).finally(() => { console.warn = original; }).then(value => ({ value, logged }));
}

test('writes ciphertext only for secret fields', async () => {
  await store.writeChannelCredential('owner-a', 'naver_cafe', { accessToken: 'access-plain-123', refreshToken: 'refresh-plain-456',
    meta: { clientId: 'cid-1', clientSecret: 'csecret-789', clubId: '111', menuId: '9' } });
  const saved = rows.get(key('owner-a', 'naver_cafe'));
  assert.match(saved.accessToken, /^v1:/);
  assert.match(saved.refreshToken, /^v1:/);
  assert.match(saved.meta.clientSecret, /^v1:/);
  assert.deepEqual({ clientId: saved.meta.clientId, clubId: saved.meta.clubId, menuId: saved.meta.menuId }, { clientId: 'cid-1', clubId: '111', menuId: '9' });
  // AAD는 정확한 context 문자열로 묶인다
  assert.equal(decryptSecret(saved.accessToken, ctx('access_token', 'owner-a', 'naver_cafe')), 'access-plain-123');
  assert.equal(decryptSecret(saved.refreshToken, ctx('refresh_token', 'owner-a', 'naver_cafe')), 'refresh-plain-456');
  assert.equal(decryptSecret(saved.meta.clientSecret, ctx('meta.clientSecret', 'owner-a', 'naver_cafe')), 'csecret-789');
  assert.ok(!JSON.stringify(saved).includes('plain-123') && !JSON.stringify(saved).includes('csecret-789'));
  // GA4 snake_case client_secret도 비밀 필드
  await store.writeChannelCredential('owner-a', 'ga4', { refreshToken: 'rt-ga4-000000', accessToken: null, meta: { client_id: 'gcid', client_secret: 'gsecret-0000' } });
  const ga4 = rows.get(key('owner-a', 'ga4'));
  assert.equal(ga4.meta.client_id, 'gcid');
  assert.equal(decryptSecret(ga4.meta.client_secret, ctx('meta.client_secret', 'owner-a', 'ga4')), 'gsecret-0000');
  assert.equal(ga4.accessToken, null);
  assert.deepEqual(store.SECRET_FIELDS.meta, ['clientSecret', 'client_secret']);
});

test('write fails closed without a valid key and touches no row', async () => {
  delete process.env.CREDENTIAL_ENCRYPTION_SECRET;
  await assert.rejects(store.writeChannelCredential('owner-a', 'instagram', { accessToken: 'tok-1234567890', meta: { businessId: 'b1' } }),
    e => e instanceof CredentialCryptoError && e.reason === 'not_configured');
  assert.deepEqual(calls, []);
});

test('reads legacy plaintext and v1 ciphertext alike', async () => {
  rows.set(key('owner-a', 'ga4'), { accessToken: null, refreshToken: 'legacy-refresh', expiresAt: null,
    meta: { client_id: 'gcid', client_secret: 'legacy-secret' }, updatedAt: new Date(0) });
  const legacy = await captureWarn(() => store.readChannelCredential('owner-a', 'ga4'));
  assert.equal(legacy.value.refreshToken, 'legacy-refresh');
  assert.equal(legacy.value.meta.client_secret, 'legacy-secret');
  assert.deepEqual(legacy.logged, [['[credentials] legacy plaintext', { channel: 'ga4' }]]);
  assert.ok(!JSON.stringify(legacy.logged).includes('legacy-refresh'));

  await store.writeChannelCredential('owner-a', 'ga4', { refreshToken: 'legacy-refresh', meta: { client_id: 'gcid', client_secret: 'legacy-secret' } });
  const sealed = await captureWarn(() => store.readChannelCredential('owner-a', 'ga4'));
  assert.equal(sealed.value.refreshToken, 'legacy-refresh');
  assert.equal(sealed.value.meta.client_secret, 'legacy-secret');
  assert.deepEqual(sealed.logged, [], '암호문 읽기는 경고하지 않는다');
  assert.equal(await store.readChannelCredential('owner-a', 'facebook'), null);
});

test('decrypt failure throws, never returns empty', async () => {
  await store.writeChannelCredential('owner-a', 'instagram', { accessToken: 'ig-token-abcdef', meta: { businessId: 'b1' } });
  // 다른 키
  process.env.CREDENTIAL_ENCRYPTION_SECRET = OTHER;
  await assert.rejects(store.readChannelCredential('owner-a', 'instagram'), e => e instanceof CredentialCryptoError && e.reason === 'key_mismatch');
  // 키 누락
  delete process.env.CREDENTIAL_ENCRYPTION_SECRET;
  await assert.rejects(store.readChannelCredential('owner-a', 'instagram'), e => e instanceof CredentialCryptoError && e.reason === 'not_configured');
  // 다른 테넌트 행으로 옮겨 붙인 암호문(AAD 불일치)
  process.env.CREDENTIAL_ENCRYPTION_SECRET = SECRET;
  rows.set(key('owner-b', 'instagram'), { ...rows.get(key('owner-a', 'instagram')) });
  await assert.rejects(store.readChannelCredential('owner-b', 'instagram'), e => e instanceof CredentialCryptoError && e.reason === 'invalid_blob');
  // 손상된 v1 값
  rows.set(key('owner-c', 'facebook'), { accessToken: 'v1:broken', refreshToken: null, meta: { pageId: 'p' }, updatedAt: new Date(0) });
  await assert.rejects(store.readChannelCredential('owner-c', 'facebook'), e => e instanceof CredentialCryptoError);
});

test('meta secret under the wrong key name cannot be decrypted with another field context', async () => {
  const blob = encryptSecret('swap-me-123456', ctx('access_token', 'owner-a', 'naver_cafe'));
  rows.set(key('owner-a', 'naver_cafe'), { accessToken: 'plain-access-1', refreshToken: blob, meta: {}, updatedAt: new Date(0) });
  await assert.rejects(store.readChannelCredential('owner-a', 'naver_cafe'), e => e instanceof CredentialCryptoError && e.reason === 'invalid_blob');
});

test('delete is owner-scoped', async () => {
  await store.writeChannelCredential('owner-a', 'facebook', { accessToken: 'fb-token-123456', meta: { pageId: 'p1' } });
  assert.equal(await store.deleteChannelCredential('owner-b', 'facebook'), 0);
  assert.equal(await store.deleteChannelCredential('owner-a', 'facebook'), 1);
});
