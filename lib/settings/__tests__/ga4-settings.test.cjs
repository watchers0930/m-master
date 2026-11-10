/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process, Buffer, console */
// 설정 › GA4: 저장 자격증명을 복호화하지 못하면 '연결됨'이 아니라 관리자 설정 오류로 구분한다.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
let row = null, anchorRow = null;
require.cache[require.resolve('../../prisma.ts')] = { exports: { prisma: {
  $queryRaw: async () => (anchorRow ? [{ kid: anchorRow }] : []),
  channelCredential: { findUnique: async () => row && { ...row } },
  ga4Binding: { findMany: async () => [] },
  setting: { findUnique: async () => null },
} } };
require.cache[require.resolve('../../auth.ts')] = { exports: { requireSession: async () => ({ user: { id: 'o' } }) } };
require.cache[require.resolve('../../ga4/auth.ts')] = { exports: { invalidateGa4Credentials: () => {} } };
const { encryptSecret, credentialKeyId } = require('../../crypto/credentials.ts');
const { ga4Settings } = require('../service.ts');
const { resetAnchorCache } = require('../../credentials/anchor.ts');
const useSecret = s => { process.env.CREDENTIAL_ENCRYPTION_SECRET = s; resetAnchorCache(); };
const SECRET = Buffer.alloc(32, 7).toString('base64'), OTHER = Buffer.alloc(32, 9).toString('base64');

test('ga4Settings: connected, not connected, and credential storage error are distinct', async () => {
  useSecret(SECRET); anchorRow = credentialKeyId();
  row = null;
  assert.deepEqual(await ga4Settings('o').then(s => [s.connected_oauth, s.oauth_error]), [false, null]);
  row = { accessToken: null, refreshToken: encryptSecret('rt-123456789', 'channel_credentials.refresh_token:o:ga4'), expiresAt: null, meta: {}, updatedAt: new Date(5) };
  assert.deepEqual(await ga4Settings('o').then(s => [s.connected_oauth, s.oauth_error, s.oauth_error_reason, s.oauth_error_recoverable]), [true, null, null, false]);
  const original = console.error; console.error = () => {};
  let s, foreign;
  try {
    // 런타임 키가 정본(앵커)이 아님 → 복구 불가
    useSecret(OTHER);
    s = await ga4Settings('o');
    // 런타임 키 = 정본, 행만 다른 키로 쓰임 → 복구 가능
    anchorRow = credentialKeyId(); resetAnchorCache();
    foreign = await ga4Settings('o');
  } finally { console.error = original; }
  assert.deepEqual([s.connected_oauth, s.oauth_error, s.oauth_error_reason, s.oauth_error_recoverable], [false, 'credential_storage_error', 'key_mismatch', false]);
  assert.deepEqual([foreign.oauth_error, foreign.oauth_error_reason, foreign.oauth_error_recoverable], ['credential_storage_error', 'key_mismatch', true]);
  assert.ok(!JSON.stringify(s).includes('rt-123456789') && !JSON.stringify(s).includes('v1:'));
});
