/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process, Buffer, console, Request */
// POST /api/admin/credential-key: 운영 런타임이 자기 kid로 앵커를 직접 쓴다(로컬 스크립트가 아니라).
// 플랫폼 오너만(그 밖은 404) · 같은 출처 증명 필수 · VERCEL_ENV=production에서만 · 같은 kid면 멱등 200 · 다른 kid면 409 · 응답에 비밀 없음.
require('../../visibility/__tests__/register.cjs');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
let user = null, anchorRow = null, dbFails = false;
const writes = [], audits = [];
require.cache[require.resolve('../../auth.ts')] = { exports: { requireSession: async () => {
  if (!user) throw new Error('Unauthorized');
  return { user: { id: user } };
} } };
require.cache[require.resolve('../../channel-credentials.ts')] = { exports: { isPlatformOwner: async (id) => id === 'owner' } };
// 앵커 테이블 1행 흉내: INSERT … ON CONFLICT (id) DO NOTHING. 훅은 기록만 한다(단언은 테스트 본문에서).
require.cache[require.resolve('../../prisma.ts')] = { exports: { prisma: {
  $queryRaw: async () => { if (dbFails) throw new Error('db down: postgresql://user:pw@host'); return anchorRow ? [{ kid: anchorRow }] : []; },
  $executeRaw: async (strings, ...values) => {
    writes.push({ sql: strings.join('?'), values });
    if (dbFails) throw new Error('db down: postgresql://user:pw@host');
    if (anchorRow) return 0;
    anchorRow = values[1];
    return 1;
  },
  auditLog: { create: async (args) => { audits.push(args.data); return args.data; } },
} } };
const { credentialKeyId } = require('../../crypto/credentials.ts');
const { resetAnchorCache } = require('../anchor.ts');
const route = require('../../../app/api/admin/credential-key/route.ts');
const SECRET = Buffer.alloc(32, 7).toString('base64');
const OTHER = Buffer.alloc(32, 9).toString('base64');
const ORIGIN = 'https://minteq.example';
beforeEach(() => {
  process.env.CREDENTIAL_ENCRYPTION_SECRET = SECRET; process.env.VERCEL_ENV = 'production';
  user = 'owner'; anchorRow = null; dbFails = false; writes.length = 0; audits.length = 0; resetAnchorCache();
});
const post = async (headers = { origin: ORIGIN }) => {
  const res = await route.POST(new Request(`${ORIGIN}/api/admin/credential-key`, { method: 'POST', headers }));
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text), text, cache: res.headers.get('cache-control') };
};
const noSecret = (text) => { for (const s of [SECRET, OTHER, 'postgresql://']) assert.equal(text.includes(s), false, s); };

test('non-owner and anonymous get the hidden 404 and nothing is written', async () => {
  for (const who of [null, 'tenant']) {
    user = who;
    const r = await post();
    assert.deepEqual([r.status, r.body.error.code], [404, 'not_found'], String(who));
    assert.equal(r.text.includes(credentialKeyId()), false);
  }
  assert.deepEqual([writes.length, anchorRow], [0, null]);
});

test('outside VERCEL_ENV=production the owner is refused and nothing is written', async () => {
  for (const env of [undefined, 'preview', 'development', 'Production', '']) {
    if (env === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = env;
    const r = await post();
    assert.deepEqual([r.status, r.body.error.code], [403, 'not_production'], String(env));
  }
  assert.deepEqual([writes.length, anchorRow], [0, null]);
});

test('owner without same-origin proof is refused (existing requireOrigin rule) and nothing is written', async () => {
  for (const headers of [{}, { origin: 'https://evil.example' }, { 'sec-fetch-site': 'cross-site', origin: ORIGIN }]) {
    const r = await post(headers);
    assert.deepEqual([r.status, r.body.error.code], [403, 'forbidden_origin'], JSON.stringify(headers));
  }
  assert.equal(writes.length, 0);
  assert.equal((await post({ 'sec-fetch-site': 'same-origin' })).status, 200, 'Origin 없이 same-origin fetch는 허용(기존 규칙)');
});

test('first call writes the runtime kid; the same kid again is idempotent 200; no secret in any response', async () => {
  const kid = credentialKeyId();
  let r = await post();
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { result: 'created', kid, anchorKid: kid, writable: true });
  assert.equal(r.cache, 'no-store');
  assert.equal(anchorRow, kid, '런타임 자기 kid가 앵커가 된다');
  assert.deepEqual(writes.map((w) => w.values), [['default', kid]]);
  assert.deepEqual(audits.map((a) => [a.actor, a.action, a.targetId]), [['owner', 'credentials.anchor.set', 'default']]);
  noSecret(r.text);
  r = await post();
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { result: 'unchanged', kid, anchorKid: kid, writable: true });
  assert.equal(anchorRow, kid);
  assert.equal(audits.length, 1, '변화 없는 호출은 감사로그를 더하지 않는다');
  noSecret(r.text);
});

test('an anchor with a different kid is a 409 conflict and is never overwritten', async () => {
  process.env.CREDENTIAL_ENCRYPTION_SECRET = OTHER;
  const other = credentialKeyId();
  anchorRow = other;
  process.env.CREDENTIAL_ENCRYPTION_SECRET = SECRET;
  const r = await post();
  assert.equal(r.status, 409);
  assert.deepEqual(r.body.error, { code: 'anchor_conflict', message: r.body.error.message, kid: credentialKeyId(), anchorKid: other });
  assert.equal(anchorRow, other);
  assert.equal(audits.length, 0);
  noSecret(r.text);
});

test('missing runtime secret is 503 not_configured without writing; DB failure is the fixed 500 with a code-only log', async () => {
  delete process.env.CREDENTIAL_ENCRYPTION_SECRET;
  let r = await post();
  assert.deepEqual([r.status, r.body.error.code], [503, 'not_configured']);
  assert.equal(writes.length, 0);
  process.env.CREDENTIAL_ENCRYPTION_SECRET = SECRET;
  const logs = []; const original = console.error; console.error = (...a) => logs.push(a);
  try { dbFails = true; r = await post(); } finally { console.error = original; }
  assert.deepEqual([r.status, r.body.error.code], [500, 'internal_error']);
  assert.deepEqual(logs, [['[credentials] anchor write failed', { code: 'internal_error' }]]);
  noSecret(r.text);
});
