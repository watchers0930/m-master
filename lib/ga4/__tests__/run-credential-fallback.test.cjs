/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require */
// owner_oauth 자격증명 복호화 실패(credential_storage_error): 재시도 안 함, 다음 후보로 대체 시 provenance에 대체 사실을 남긴다.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Ga4Failure } = require('../errors.ts');
let candidates = [];
require.cache[require.resolve('../auth.ts')] = { exports: { credentialCandidates: async () => candidates } };
const { runGa4 } = require('../run.ts');
const { classifyGa4Error } = require('../errors.ts');
const { ga4ConsultingSchema } = require('../../../schemas/ga4-consulting.ts');
const scope = owner => ({ ownerId: owner, domainId: 'd', bindingId: 'b-' + owner, propertyId: 'properties/123', host: 'example.com', allowedSources: ['owner_oauth', 'env_oauth'], conversionEvents: [] });
const range = { startDate: '2026-10-01', endDate: '2026-10-30' };
const broken = { source: 'owner_oauth', version: 'owner_oauth:x', client: () => { throw new Ga4Failure('credential_storage_error'); } };
const working = { source: 'env_oauth', version: 'env_oauth:y', client: () => ({ runReport: async () => [{ rows: [], rowCount: 0, metadata: { timeZone: 'Asia/Seoul' } }] }) };
const query = (owner) => runGa4(scope(owner), 'fallback', range, async (client, property) => { await client.runReport({ property, metrics: [{ name: 'sessions' }] }); return 1; });

test('credential_storage_error is not retryable', () => {
  assert.deepEqual(classifyGa4Error(new Ga4Failure('credential_storage_error')), { code: 'credential_storage_error', retryable: false });
});

test('owner_oauth storage error alone surfaces as credential_storage_error', async () => {
  candidates = [broken];
  const result = await query('alone');
  assert.equal(result.status, 'error');
  assert.equal(result.code, 'credential_storage_error');
  assert.equal(result.retryable, false);
  assert.deepEqual(result.attempts, [{ source: 'owner_oauth', code: 'credential_storage_error' }]);
});

test('env_oauth fallback still works and provenance records the failed owner_oauth (not silent)', async () => {
  candidates = [broken, working];
  const result = await query('fallback');
  assert.equal(result.status, 'success');
  assert.equal(result.provenance.credentialSource, 'env_oauth');
  assert.deepEqual(result.provenance.credentialFallbacks, [{ source: 'owner_oauth', code: 'credential_storage_error' }]);
  // 컨설팅 동결 스키마(strict)가 새 필드를 받아들인다
  const reports = { channels: [], sourceMedium: [], landing: [], pages: [], events: [], totals: { channels: null, landing: null, pages: null, events: null } };
  assert.equal(ga4ConsultingSchema.safeParse({ provenance: result.provenance, reports, failedQueries: [{ report: 'channels', code: 'credential_storage_error' }] }).success, true);
  candidates = [working];
  const clean = await query('clean');
  assert.equal('credentialFallbacks' in clean.provenance, false);
});
