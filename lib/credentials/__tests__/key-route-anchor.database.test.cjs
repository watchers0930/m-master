/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, __dirname, process, Buffer, console, Request */
// 실DB(PGlite): POST /api/admin/credential-key가 실제 credential_key_anchor 행을 런타임 kid로 만든다 → 같은 kid 멱등 → 다른 키 런타임은 409·행 불변.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process'), { createRequire } = require('node:module');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;
const SECRET = Buffer.alloc(32, 7).toString('base64');
const OTHER = Buffer.alloc(32, 9).toString('base64');
const ORIGIN = 'https://minteq.example';

test('production POST writes the anchor on a real database', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async () => {
  const runtime = createRequire(path.join(packageDir, 'package.json'));
  const { PGlite } = runtime('@electric-sql/pglite'), { PGLiteSocketServer } = runtime('@electric-sql/pglite-socket');
  const { PrismaClient } = require('@prisma/client'), root = path.resolve(__dirname, '../../..');
  const db = await PGlite.create(); let server, client;
  const warn = console.warn; console.warn = () => {};
  try {
    const ddl = execFileSync(path.join(root, 'node_modules/.bin/prisma'), ['migrate', 'diff', '--from-empty', '--to-schema-datamodel', path.join(root, 'prisma/schema.prisma'), '--script'], { encoding: 'utf8' })
      .replace(/CREATE EXTENSION[^;]*;/g, '').replace(/vector\(1536\)/g, 'TEXT');
    await db.exec(ddl);
    server = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1' }); await server.start();
    let address = server.getServerConn(); if (!address.startsWith('postgres')) address = 'postgresql://postgres:postgres@' + address + '/postgres';
    client = new PrismaClient({ datasources: { db: { url: address + (address.includes('?') ? '&' : '?') + 'connection_limit=1&sslmode=disable' } } });
    require.cache[require.resolve('../../prisma.ts')] = { exports: { prisma: client } };
    require.cache[require.resolve('../../auth.ts')] = { exports: { requireSession: async () => ({ user: { id: 'owner' } }) } };
    require.cache[require.resolve('../../channel-credentials.ts')] = { exports: { isPlatformOwner: async (id) => id === 'owner' } };
    const { credentialKeyId } = require('../../crypto/credentials.ts');
    const { resetAnchorCache } = require('../anchor.ts');
    const route = require('../../../app/api/admin/credential-key/route.ts');
    const post = async () => {
      resetAnchorCache();
      const res = await route.POST(new Request(`${ORIGIN}/api/admin/credential-key`, { method: 'POST', headers: { origin: ORIGIN } }));
      return { status: res.status, body: await res.json() };
    };
    const rows = () => client.credentialKeyAnchor.findMany({ select: { id: true, kid: true } });
    process.env.VERCEL_ENV = 'production';
    process.env.CREDENTIAL_ENCRYPTION_SECRET = SECRET;
    const kid = credentialKeyId();

    let r = await post();
    assert.deepEqual([r.status, r.body.result, r.body.anchorKid, r.body.writable], [200, 'created', kid, true]);
    assert.deepEqual(await rows(), [{ id: 'default', kid }]);
    assert.deepEqual((await client.auditLog.findMany({ select: { actor: true, action: true } })), [{ actor: 'owner', action: 'credentials.anchor.set' }]);

    r = await post();
    assert.deepEqual([r.status, r.body.result], [200, 'unchanged']);
    assert.deepEqual(await rows(), [{ id: 'default', kid }]);

    process.env.CREDENTIAL_ENCRYPTION_SECRET = OTHER;
    r = await post();
    assert.deepEqual([r.status, r.body.error.code, r.body.error.anchorKid], [409, 'anchor_conflict', kid]);
    assert.deepEqual(await rows(), [{ id: 'default', kid }], '다른 키 런타임은 앵커를 덮어쓰지 못한다');
    assert.equal(await client.auditLog.count(), 1);
  } finally {
    delete process.env.VERCEL_ENV; delete process.env.CREDENTIAL_ENCRYPTION_SECRET;
    await client?.$disconnect(); await server?.stop(); await db.close(); console.warn = warn;
  }
});
