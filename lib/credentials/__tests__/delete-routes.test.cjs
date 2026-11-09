/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process, Buffer, console, Request, __dirname */
// 삭제도 자격증명 변경이다: 런타임 키 kid == DB 앵커 kid 인 환경에서만 허용.
// 거부는 쓰기와 같은 처리된 오류(503 credential_storage_unavailable)로, 행은 그대로 둔다.
require('../../visibility/__tests__/register.cjs');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
let anchor = null, deletes = 0, invalidated = 0, audits = 0, tableMissing = false;
require.cache[require.resolve('../../auth.ts')] = { exports: { requireSession: async () => ({ user: { id: 'o' } }) } };
require.cache[require.resolve('../../audit/logger.ts')] = { exports: { logAudit: async () => { audits++; } } };
require.cache[require.resolve('../../ga4/auth.ts')] = { exports: { invalidateGa4Credentials: () => { invalidated++; } } };
require.cache[require.resolve('../../prisma.ts')] = { exports: { prisma: {
  $queryRaw: async () => {
    if (tableMissing) throw Object.assign(new Error('relation "credential_key_anchor" does not exist'), { code: 'P2010', meta: { code: '42P01' } });
    return anchor ? [{ kid: anchor }] : [];
  },
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
beforeEach(() => { process.env.CREDENTIAL_ENCRYPTION_SECRET = SECRET; anchor = credentialKeyId(); resetAnchorCache(); deletes = 0; invalidated = 0; audits = 0; tableMissing = false; });
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

test('anchor table missing (migration not applied): deletes take the classified 503 path, not a raw 500', async () => {
  tableMissing = true; resetAnchorCache();
  for (const call of [channelDelete, ga4Delete]) {
    const res = await quiet(call);
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error.code, 'credential_storage_unavailable');
  }
  assert.deepEqual([deletes, invalidated, audits], [0, 0, 0]);
});

test('GA4 disconnect refusal message reaches the client error that Ga4ConnectionCard renders', async () => {
  // 경로: authenticated → jsonError(VisibilityError 503) → lib/api/ga4-settings send() → useMutation.error → 카드 role=alert {message}
  process.env.CREDENTIAL_ENCRYPTION_SECRET = OTHER; resetAnchorCache();
  const { disconnectGa4Oauth } = require('../../api/ga4-settings.ts');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => ga4.DELETE(new Request('http://localhost' + url, { ...init, headers: { origin: 'http://localhost' } }));
  try {
    await quiet(() => assert.rejects(disconnectGa4Oauth(), e => e instanceof Error && e.message === '자격증명을 안전하게 변경할 수 없습니다. 관리자에게 문의하세요.'));
  } finally { globalThis.fetch = originalFetch; }
  const fs = require('node:fs'), path = require('node:path');
  const card = fs.readFileSync(path.resolve(__dirname, '../../../app/(dashboard)/settings/components/Ga4ConnectionCard.tsx'), 'utf8');
  assert.match(card, /const actionError = \(disconnect\.error \?\?/);
  assert.match(card, /role="alert"[^>]*>\{actionError\.message\}/);
});
