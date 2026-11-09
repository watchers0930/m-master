/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, __dirname, process, Buffer, console */
// 발행 중 저장 자격증명 복호화 실패 = 전송 없는 확정 실패 → claim 'failed'(unknown 아님), 활성 claim으로 남지 않는다.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process'), { createRequire } = require('node:module');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;

test('publish with an undecryptable credential fails definitely without sending', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async () => {
  const runtime = createRequire(path.join(packageDir, 'package.json'));
  const { PGlite } = runtime('@electric-sql/pglite'), { PGLiteSocketServer } = runtime('@electric-sql/pglite-socket');
  const { PrismaClient } = require('@prisma/client'), root = path.resolve(__dirname, '../../..');
  const db = await PGlite.create(); let server, client;
  const realFetch = globalThis.fetch, realError = console.error; let fetches = 0; const logged = [];
  try {
    const ddl = execFileSync(path.join(root, 'node_modules/.bin/prisma'), ['migrate', 'diff', '--from-empty', '--to-schema-datamodel', path.join(root, 'prisma/schema.prisma'), '--script'], { encoding: 'utf8' })
      .replace(/CREATE EXTENSION[^;]*;/g, '').replace(/vector\(1536\)/g, 'TEXT');
    await db.exec(ddl);
    await db.exec(`INSERT INTO users(id,email,password_hash,updated_at) VALUES ('owner','owner@test','unused',now())`);
    server = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1' }); await server.start();
    let address = server.getServerConn(); if (!address.startsWith('postgres')) address = 'postgresql://postgres:postgres@' + address + '/postgres';
    client = new PrismaClient({ datasources: { db: { url: address + (address.includes('?') ? '&' : '?') + 'connection_limit=1&sslmode=disable' } } });
    require.cache[require.resolve('../../prisma.ts')] = { exports: { prisma: client } };
    require.cache[require.resolve('../../auth.ts')] = { exports: { requireSession: async () => ({ user: { id: 'owner' } }) } };
    const { encryptSecret, credentialKeyId } = require('../../crypto/credentials.ts');
    // 다른 환경 키로 저장된 facebook 토큰(운영 키 불일치 상황)
    process.env.CREDENTIAL_ENCRYPTION_SECRET = Buffer.alloc(32, 9).toString('base64'); process.env.CREDENTIAL_KEY_ID = credentialKeyId();
    const blob = encryptSecret('fb-token-123456', 'channel_credentials.access_token:owner:facebook');
    process.env.CREDENTIAL_ENCRYPTION_SECRET = Buffer.alloc(32, 7).toString('base64'); process.env.CREDENTIAL_KEY_ID = credentialKeyId();
    await db.exec(`INSERT INTO channel_credentials(id,owner_id,channel,access_token,meta,updated_at) VALUES ('fb','owner','facebook','${blob}','{"pageId":"page-1"}',now())`);
    globalThis.fetch = async () => { fetches++; throw new Error('network must not be called'); };
    console.error = (...args) => logged.push(args);
    const { createContentRecord } = require('../../content/writer.ts');
    const { publishContentNow } = require('../service.ts');
    const content = await createContentRecord(client, { origin: 'manual', channel: 'facebook', ownerId: 'owner', topic: 't', keywords: [], bodyImageUrls: [], textBody: 'body' });
    for (let i = 0; i < 2; i++) {
      await assert.rejects(publishContentNow({ ownerId: 'owner', contentId: content.id, channel: 'facebook', trigger: 'manual' }), e => e.code === 'channel_error');
    }
    const claims = await client.publishClaim.findMany({ where: { targetId: content.id }, select: { status: true, errorCode: true } });
    assert.deepEqual(claims.map(c => c.status), ['failed', 'failed'], '확정 실패 — unknown이 아니고, 다음 시도가 claim_held로 막히지 않는다');
    assert.equal(fetches, 0, '외부 전송 없음');
    assert.ok(logged.some(a => a[0] === '[credentials] decrypt failed' && a[1].channel === 'facebook' && a[1].reason === 'key_mismatch'));
    assert.ok(!JSON.stringify(logged).includes('fb-token') && !JSON.stringify(logged).includes(blob));

    // 네이버 카페 기본 게시판: claim 전에 목적지 키를 자격증명으로 정하는 경로(claims.canonicalDestinationKey)도 분류된 확정 실패
    const cafeBlob = (() => {
      process.env.CREDENTIAL_ENCRYPTION_SECRET = Buffer.alloc(32, 9).toString('base64'); process.env.CREDENTIAL_KEY_ID = credentialKeyId();
      try { return encryptSecret('cafe-token-123456', 'channel_credentials.access_token:owner:naver_cafe'); }
      finally { process.env.CREDENTIAL_ENCRYPTION_SECRET = Buffer.alloc(32, 7).toString('base64'); process.env.CREDENTIAL_KEY_ID = credentialKeyId(); }
    })();
    await db.exec(`INSERT INTO channel_credentials(id,owner_id,channel,access_token,meta,updated_at) VALUES ('cafe','owner','naver_cafe','${cafeBlob}','{"clubId":"11","menuId":"22"}',now())`);
    const cafe = await createContentRecord(client, { origin: 'manual', channel: 'naver_cafe', ownerId: 'owner', topic: 't', keywords: [], bodyImageUrls: [], textBody: 'body' });
    const { VisibilityError } = require('../../visibility/http.ts');
    await assert.rejects(publishContentNow({ ownerId: 'owner', contentId: cafe.id, channel: 'naver_cafe', trigger: 'manual' }),
      e => e instanceof VisibilityError && e.code === 'credential_storage_error' && e.status === 422);
    assert.equal(await client.publishClaim.count({ where: { targetId: cafe.id } }), 0, 'claim을 만들지 않는다');
    assert.equal(fetches, 0);
    assert.ok(logged.some(a => a[0] === '[credentials] decrypt failed' && a[1].channel === 'naver_cafe'));
  } finally {
    globalThis.fetch = realFetch; console.error = realError;
    await client?.$disconnect(); await server?.stop(); await db.close();
  }
});
