/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process, Buffer, __dirname */
// 단일 봉인 진입점 sealForStorage: 앵커 판정(런타임 kid == DB 앵커 kid) 후에만 암호화한다.
// db를 주면 캐시 없이 그 db(트랜잭션)로 앵커를 다시 읽는다(백필 의미 유지).
require('../../visibility/__tests__/register.cjs');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');

let anchor = null, appQueries = 0;
require.cache[require.resolve('../../prisma.ts')] = { exports: { prisma: { $queryRaw: async () => { appQueries++; return anchor ? [{ kid: anchor }] : []; } } } };
const { credentialKeyId, decryptSecret, CredentialCryptoError } = require('../../crypto/credentials.ts');
const { resetAnchorCache } = require('../anchor.ts');
const { sealForStorage } = require('../seal.ts');

const SECRET = Buffer.alloc(32, 7).toString('base64');
const OTHER = Buffer.alloc(32, 9).toString('base64');
const CTX = 'channel_credentials.access_token:o:naver_cafe';
const useSecret = s => { process.env.CREDENTIAL_ENCRYPTION_SECRET = s; resetAnchorCache(); };
const reason = r => e => e instanceof CredentialCryptoError && e.reason === r;
beforeEach(() => { useSecret(SECRET); anchor = credentialKeyId(); appQueries = 0; resetAnchorCache(); });

test('sealForStorage encrypts only when runtime kid equals the anchor', async () => {
  const blob = await sealForStorage('plain-token-123', CTX);
  assert.match(blob, /^v1:/);
  assert.equal(decryptSecret(blob, CTX), 'plain-token-123');
  anchor = null; resetAnchorCache();
  await assert.rejects(sealForStorage('plain-token-123', CTX), reason('not_configured'));
  anchor = credentialKeyId(); useSecret(OTHER);
  await assert.rejects(sealForStorage('plain-token-123', CTX), reason('key_mismatch'));
  delete process.env.CREDENTIAL_ENCRYPTION_SECRET;
  await assert.rejects(sealForStorage('plain-token-123', CTX), reason('not_configured'));
});

test('sealForStorage with db re-reads the anchor from that db, bypassing the app cache', async () => {
  await sealForStorage('warm-cache-1', CTX); // 앱 캐시 = 정본 앵커
  const before = appQueries;
  let txQueries = 0;
  const tx = { $queryRaw: async () => { txQueries++; return []; } }; // 트랜잭션에서 본 앵커: 없음
  await assert.rejects(sealForStorage('plain-token-123', CTX, tx), reason('not_configured'));
  assert.equal(txQueries, 1);
  assert.equal(appQueries, before, '앱 캐시 경로를 쓰지 않는다');
  const ok = { $queryRaw: async () => [{ kid: credentialKeyId() }] };
  assert.equal(decryptSecret(await sealForStorage('plain-token-123', CTX, ok), CTX), 'plain-token-123');
});

const runbook = fs.readFileSync(path.resolve(__dirname, '../../../scripts/db/encrypt-channel-credentials.ts'), 'utf8');
const header = runbook.split('\nimport ')[0];

test('runbook: (0) approval + migration + table check comes before deploying this code', () => {
  const step0 = header.indexOf('(0)'), deploy = header.indexOf('(2)');
  assert.ok(step0 >= 0 && deploy > step0, '(0)이 (2) 배포보다 앞');
  const zero = header.slice(step0, header.indexOf('(1)'));
  assert.match(zero, /대장 승인/);
  assert.match(zero, /prisma\/manual-migrations\/20261110_credential_key_anchor\.sql/);
  assert.match(zero, /credential_key_anchor/);
  assert.match(zero, /확인/);
});

test('runbook: secret is generated straight into a variable, never printed, then unset', () => {
  assert.ok(header.includes('S=$(openssl rand -base64 32)'));
  assert.ok(header.includes('unset S'));
  assert.ok(!header.includes('read -s'), '붙여넣기 방식(read -s)은 쓰지 않는다');
  assert.ok(!/echo\s+"?\$S/.test(header), '비밀을 echo로 출력하지 않는다');
  for (const file of ['scripts/crypto/key-id.ts', 'scripts/crypto/set-anchor.ts']) {
    const text = fs.readFileSync(path.resolve(__dirname, '../../..', file), 'utf8');
    assert.ok(!text.includes('read -s'), file);
  }
});

test('runbook: recovery for a wrongly set anchor needs approval and re-entry of rows written under the wrong key', () => {
  const at = header.indexOf('앵커를 잘못');
  assert.ok(at >= 0, '잘못 설정된 앵커 복구 절차');
  const recovery = header.slice(at);
  assert.match(recovery, /GET \/api\/admin\/credential-key/);
  assert.match(recovery, /대장 승인/);
  assert.ok(recovery.includes("DELETE FROM credential_key_anchor WHERE id='default'"));
  assert.match(recovery, /set-anchor/);
  assert.match(recovery, /다시 입력/);
});
