/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, console */
// 카페 파생(derive)·자동발행(auto-publish): 자격증명 복호화 실패는 원본 throw 없이 분류된 skip + failed 이벤트 후 completed.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
let mode = 'crypto', converted = 0;
require.cache[require.resolve('../../prisma.ts')] = { exports: { prisma: { content: {
  findFirst: async ({ where }) => (where.parentContentId ? null : { id: 'p', topic: 't', textBody: 'b', keywords: [], bodyImageUrls: [], imageUrl: null }),
} } } };
const { CredentialCryptoError } = require('../../crypto/credentials.ts');
require.cache[require.resolve('../../channel-credentials.ts')] = { exports: { getNaverCafeCreds: async () => {
  if (mode === 'crypto') throw new CredentialCryptoError('key_mismatch');
  if (mode === 'db') throw new Error('db down');
  return null;
} } };
require.cache[require.resolve('../../claude/convert.ts')] = { exports: { convertBlogToChannel: async () => { converted++; throw new Error('must not convert'); } } };
require.cache[require.resolve('../../billing/limits.ts')] = { exports: { getUserPlan: async () => 'pro', checkCostLimit: async () => {} } };
require.cache[require.resolve('../../content/writer.ts')] = { exports: { createContentRecord: async () => { throw new Error('must not write'); } } };
require.cache[require.resolve('../../pipeline/run-claim.ts')] = { exports: { claimPipelineRun: async () => { throw new Error('must not claim'); }, finishPipelineRun: async () => {} } };
const { deriveCafeContent } = require('../derive.ts');
const { autoPublishToSocial } = require('../auto-publish.ts');

test('derive: decrypt failure is a classified skip (no raw throw, no claim, no conversion)', async () => {
  const original = console.error, logged = []; console.error = (...a) => logged.push(a);
  try {
    mode = 'crypto';
    assert.deepEqual(await deriveCafeContent('o', 'p'), { status: 'skipped', childContentId: null, reason: 'credential_storage_error' });
    mode = 'none';
    assert.deepEqual(await deriveCafeContent('o', 'p'), { status: 'skipped', childContentId: null, reason: 'no_credentials' });
    mode = 'db';
    await assert.rejects(deriveCafeContent('o', 'p'), /db down/, '암호화와 무관한 오류는 그대로 전파');
  } finally { console.error = original; }
  assert.equal(converted, 0);
  assert.deepEqual(logged, [['[credentials] decrypt failed', { channel: 'naver_cafe', reason: 'key_mismatch' }]]);
});

test('auto-publish: decrypt failure emits failed(code) then completed', async () => {
  mode = 'crypto';
  const events = [];
  const original = console.error; console.error = () => {};
  try {
    await autoPublishToSocial({ blogContentId: 'p', ownerId: 'o', blogText: 'b', topic: 't', imageUrl: null, bodyImageUrls: [], blogScores: null, onProgress: e => events.push(e) });
  } finally { console.error = original; }
  assert.deepEqual(events, [
    { type: 'auto_publish', channel: 'naver_cafe', status: 'failed', error: 'credential_storage_error' },
    { type: 'auto_publish', status: 'completed' },
  ]);
  mode = 'none'; events.length = 0;
  await autoPublishToSocial({ blogContentId: 'p', ownerId: 'o', blogText: 'b', topic: 't', imageUrl: null, bodyImageUrls: [], blogScores: null, onProgress: e => events.push(e) });
  assert.deepEqual(events, [{ type: 'auto_publish', status: 'completed' }]);
});
