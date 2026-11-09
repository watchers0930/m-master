/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process, Buffer, console, Request */
// 삭제도 자격증명 변경이다: 런타임 키 kid == DB 앵커 kid 인 환경에서만 허용.
// 거부는 쓰기와 같은 처리된 오류(503 credential_storage_unavailable)로, 행은 그대로 둔다.
require('../../visibility/__tests__/register.cjs');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
let anchor = null, deletes = 0, invalidated = 0, audits = 0;
require.cache[require.resolve('../../auth.ts')] = { exports: { requireSession: async () => ({ user: { id: 'o' } }) } };
require.cache[require.resolve('../../audit/logger.ts')] = { exports: { logAudit: async () => { audits++; } } };
require.cache[require.resolve('../../ga4/auth.ts')] = { exports: { invalidateGa4Credentials: () => { invalidated++; } } };
require.cache[require.resolve('../../prisma.ts')] = { exports: { prisma: {
  $queryRaw: async () => (anchor ? [{ kid: anchor }] : []),
  channelCredential: { deleteMany: async () => { deletes++; return { count: 1 }; } },
} } };
const { credentialKeyId } = require('../../crypto/credentials.ts');
const { resetAnchorCache } = require('../anchor.ts');
const channels = require('../../../app/api/channels/route.ts');
const ga4 = require('../../../app/api/settings/ga4/route.ts');
const SECRET = Buffer.alloc(32, 7).toString('base64');
const OTHER = Buffer.alloc(32, 9).toString('base64');
const URL_ = 'http://localhost/api/x';
const channelDelete = () => channels.DELETE(new Request(URL_, { method: 'DELETE', body: JSON.stringify({ channel: 'facebook' }), headers: { 'content-type': 'application/json' } }));
const ga4Delete = () => ga4.DELETE(new Request(URL_, { method: 'DELETE', headers: { origin: 'http://localhost' } }));
beforeEach(() => { process.env.CREDENTIAL_ENCRYPTION_SECRET = SECRET; anchor = credentialKeyId(); resetAnchorCache(); deletes = 0; invalidated = 0; audits = 0; });
const quiet = async fn => { const o = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = o; } };

test('DELETE /api/channels: allowed only from the canonical-key environment', async () => {
  const ok = await channelDelete();
  assert.equal(ok.status, 200);
  assert.deepEqual([deletes, audits], [1, 1]);
  for (const setup of [() => { anchor = null; }, () => { process.env.CREDENTIAL_ENCRYPTION_SECRET = OTHER; }, () => { delete process.env.CREDENTIAL_ENCRYPTION_SECRET; }]) {
    process.env.CREDENTIAL_ENCRYPTION_SECRET = SECRET; anchor = credentialKeyId(); setup(); resetAnchorCache();
    const res = await quiet(channelDelete);
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error.code, 'credential_storage_unavailable');
  }
  assert.deepEqual([deletes, audits], [1, 1], '거부 시 삭제·감사 기록 없음');
});

test('DELETE /api/settings/ga4: same guard, same handled 503, cache not invalidated on refusal', async () => {
  const ok = await ga4Delete();
  assert.equal(ok.status, 200);
  assert.deepEqual([deletes, invalidated], [1, 1]);
  process.env.CREDENTIAL_ENCRYPTION_SECRET = OTHER; resetAnchorCache();
  const res = await quiet(ga4Delete);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error.code, 'credential_storage_unavailable');
  anchor = null; process.env.CREDENTIAL_ENCRYPTION_SECRET = SECRET; resetAnchorCache();
  assert.equal((await quiet(ga4Delete)).status, 503);
  assert.deepEqual([deletes, invalidated], [1, 1]);
});
