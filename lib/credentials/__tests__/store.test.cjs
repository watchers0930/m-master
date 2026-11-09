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
const prismaMock = require.cache[require.resolve('../../prisma.ts')].exports.prisma;
// 쓰기 트랜잭션: 행 잠금 재조회(FOR UPDATE)를 흉내낸다 — 기록된 SQL로 잠금 여부도 확인
let lockedSql = [];
prismaMock.$queryRaw = async (strings, ...values) => {
  calls.push('$queryRaw'); lockedSql.push(strings.join('?'));
  const r = rows.get(key(values[0], values[1]));
  return r ? [{ access_token: r.accessToken ?? null, refresh_token: r.refreshToken ?? null, meta: r.meta ?? null }] : [];
};
prismaMock.$transaction = async (fn) => { calls.push('$transaction'); return fn(prismaMock); };
const { encryptSecret, decryptSecret, credentialKeyId, CredentialCryptoError } = require('../../crypto/credentials.ts');
const store = require('../store.ts');

const ctx = (field, ownerId, channel) => `channel_credentials.${field}:${ownerId}:${channel}`;
function useSecret(secret) { process.env.CREDENTIAL_ENCRYPTION_SECRET = secret; process.env.CREDENTIAL_KEY_ID = credentialKeyId(); }
beforeEach(() => { useSecret(SECRET); rows = new Map(); calls = []; lockedSql = []; });
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

test('writes with only meta or only non-secret fields still fail closed when the key is invalid', async () => {
  // 비밀 필드가 없어 encryptSecret이 호출되지 않는 쓰기도 키 가드로 거부돼야 한다(가드 삭제 회귀 방지)
  const nonSecret = [{ meta: { businessId: 'b1' } }, { expiresAt: '123' }, { meta: { clubId: '1', menuId: '2', clientSecret: '' } }, {}];
  delete process.env.CREDENTIAL_ENCRYPTION_SECRET;
  for (const data of nonSecret) {
    await assert.rejects(store.writeChannelCredential('owner-a', 'instagram', data), e => e instanceof CredentialCryptoError && e.reason === 'not_configured');
  }
  useSecret(SECRET);
  delete process.env.CREDENTIAL_KEY_ID;
  for (const data of nonSecret) {
    await assert.rejects(store.writeChannelCredential('owner-a', 'instagram', data), e => e instanceof CredentialCryptoError && e.reason === 'not_configured');
  }
  // 다른 환경 키(KEY_ID 불일치) → key_mismatch
  useSecret(OTHER); process.env.CREDENTIAL_ENCRYPTION_SECRET = SECRET;
  for (const data of nonSecret) {
    await assert.rejects(store.writeChannelCredential('owner-a', 'instagram', data), e => e instanceof CredentialCryptoError && e.reason === 'key_mismatch');
  }
  assert.deepEqual(calls, []);
});

test('partial write re-encrypts legacy plaintext secrets left in the same row (under a row lock)', async () => {
  rows.set(key('owner-a', 'naver_cafe'), { accessToken: 'legacy-access-1', refreshToken: 'legacy-refresh-2', expiresAt: null,
    meta: { clientId: 'cid', clientSecret: 'legacy-secret-3', clubId: '11' }, updatedAt: new Date(0) });
  await store.writeChannelCredential('owner-a', 'naver_cafe', { expiresAt: '999' });
  const saved = rows.get(key('owner-a', 'naver_cafe'));
  assert.equal(saved.expiresAt, '999');
  assert.equal(decryptSecret(saved.accessToken, ctx('access_token', 'owner-a', 'naver_cafe')), 'legacy-access-1');
  assert.equal(decryptSecret(saved.refreshToken, ctx('refresh_token', 'owner-a', 'naver_cafe')), 'legacy-refresh-2');
  assert.equal(decryptSecret(saved.meta.clientSecret, ctx('meta.clientSecret', 'owner-a', 'naver_cafe')), 'legacy-secret-3');
  assert.deepEqual([saved.meta.clientId, saved.meta.clubId], ['cid', '11']);
  assert.ok(!JSON.stringify(saved).includes('legacy-'));
  assert.ok(lockedSql.some(sql => /FOR UPDATE/.test(sql)), '기존 행은 잠금 재조회로 읽는다');
  assert.ok(calls.indexOf('$transaction') < calls.indexOf('upsert'));
  // 이미 암호화된 필드는 다시 암호화하지 않는다
  const before = { ...rows.get(key('owner-a', 'naver_cafe')) };
  await store.writeChannelCredential('owner-a', 'naver_cafe', { expiresAt: '1000' });
  const after = rows.get(key('owner-a', 'naver_cafe'));
  assert.equal(after.accessToken, before.accessToken);
  assert.deepEqual(after.meta, before.meta);
});

test('credentialPresence reports decrypt failure distinctly and never returns values', async () => {
  assert.equal(await store.credentialPresence('owner-a', 'ga4'), null);
  await store.writeChannelCredential('owner-a', 'ga4', { refreshToken: 'rt-value-123456', meta: { client_id: 'c', client_secret: 'secret-123456' } });
  const ok = await store.credentialPresence('owner-a', 'ga4');
  assert.deepEqual({ has: ok.hasRefreshToken, error: ok.error }, { has: true, error: null });
  assert.ok(!JSON.stringify(ok).includes('rt-value'));
  process.env.CREDENTIAL_ENCRYPTION_SECRET = OTHER;
  const original = console.error, logged = [];
  console.error = (...args) => logged.push(args);
  try {
    const bad = await store.credentialPresence('owner-a', 'ga4');
    assert.deepEqual({ has: bad.hasRefreshToken, error: bad.error }, { has: false, error: 'decrypt_failed' });
  } finally { console.error = original; }
  assert.deepEqual(logged, [['[credentials] decrypt failed', { channel: 'ga4', reason: 'key_mismatch' }]]);
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
  // 다른 키(읽기는 CREDENTIAL_KEY_ID와 무관)
  process.env.CREDENTIAL_ENCRYPTION_SECRET = OTHER;
  await assert.rejects(store.readChannelCredential('owner-a', 'instagram'), e => e instanceof CredentialCryptoError && e.reason === 'key_mismatch');
  // 키 누락
  delete process.env.CREDENTIAL_ENCRYPTION_SECRET;
  await assert.rejects(store.readChannelCredential('owner-a', 'instagram'), e => e instanceof CredentialCryptoError && e.reason === 'not_configured');
  // 다른 테넌트 행으로 옮겨 붙인 암호문(AAD 불일치)
  useSecret(SECRET);
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

test('decrypt failure is logged once per process per (channel, reason)', async () => {
  const { CredentialCryptoError } = require('../../crypto/credentials.ts');
  const original = console.error, logged = [];
  console.error = (...args) => logged.push(args);
  try {
    for (let i = 0; i < 3; i++) store.logDecryptFailure('dedup_channel', new CredentialCryptoError('key_mismatch'));
    store.logDecryptFailure('dedup_channel', new CredentialCryptoError('invalid_blob'));
    store.logDecryptFailure('dedup_other', new CredentialCryptoError('key_mismatch'));
  } finally { console.error = original; }
  assert.deepEqual(logged, [
    ['[credentials] decrypt failed', { channel: 'dedup_channel', reason: 'key_mismatch' }],
    ['[credentials] decrypt failed', { channel: 'dedup_channel', reason: 'invalid_blob' }],
    ['[credentials] decrypt failed', { channel: 'dedup_other', reason: 'key_mismatch' }],
  ]);
});
