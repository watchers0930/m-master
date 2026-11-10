/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test helper. */
/* global require, module, __dirname, process, console, Buffer, Request */
// 광고 계정 DB 테스트 공용 준비: PGlite(전체 schema.prisma DDL) + Prisma 연결 + 정본 키 앵커 + 세션·fetch 가짜.
// 반환된 close()를 finally에서 반드시 부른다.
const path = require('node:path');
const { execFileSync } = require('node:child_process'), { createRequire } = require('node:module');

const SECRET = Buffer.alloc(32, 7).toString('base64');

async function setupAdsDb(packageDir) {
  const runtime = createRequire(path.join(packageDir, 'package.json'));
  const { PGlite } = runtime('@electric-sql/pglite'), { PGLiteSocketServer } = runtime('@electric-sql/pglite-socket');
  const { PrismaClient } = require('@prisma/client'), root = path.resolve(__dirname, '../../../..');
  const warn = console.warn; console.warn = () => {};
  const db = await PGlite.create();
  const ddl = execFileSync(path.join(root, 'node_modules/.bin/prisma'), ['migrate', 'diff', '--from-empty', '--to-schema-datamodel', path.join(root, 'prisma/schema.prisma'), '--script'], { encoding: 'utf8' })
    .replace(/CREATE EXTENSION[^;]*;/g, '').replace(/vector\(1536\)/g, 'TEXT');
  await db.exec(ddl);
  await db.exec(`INSERT INTO users(id,email,password_hash,updated_at) VALUES ('owner','owner@t','x',now()),('other','other@t','x',now()),('outsider','out@t','x',now())`);
  const server = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1' }); await server.start();
  let address = server.getServerConn(); if (!address.startsWith('postgres')) address = 'postgresql://postgres:postgres@' + address + '/postgres';
  const client = new PrismaClient({ datasources: { db: { url: address + (address.includes('?') ? '&' : '?') + 'connection_limit=1&sslmode=disable' } } });
  require.cache[require.resolve(path.join(root, 'lib/prisma.ts'))] = { exports: { prisma: client } };
  // 세션 가짜: session.user = 현재 사용자(null = 미로그인)
  const session = { user: 'owner' };
  require.cache[require.resolve(path.join(root, 'lib/auth.ts'))] = { exports: { requireSession: async () => {
    if (!session.user) throw new Error('Unauthorized');
    return { user: { id: session.user } };
  } } };
  process.env.CREDENTIAL_ENCRYPTION_SECRET = SECRET;
  process.env.ADS_OWNER_IDS = 'owner, other';
  const anchor = require(path.join(root, 'lib/credentials/anchor.ts'));
  const { credentialKeyId } = require(path.join(root, 'lib/crypto/credentials.ts'));
  anchor.resetAnchorCache();
  await anchor.setAnchor(client, credentialKeyId());
  const realFetch = globalThis.fetch;
  return {
    db, client, session, root, anchor,
    useFetch: (fn) => { globalThis.fetch = fn; },
    close: async () => { globalThis.fetch = realFetch; console.warn = warn; await client.$disconnect(); await server.stop(); await db.close(); },
  };
}

// 같은 출처 변이 요청(requireOrigin 통과)
function request(method, url, body) {
  const headers = { origin: 'http://localhost' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  return new Request(`http://localhost${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

module.exports = { setupAdsDb, request, SECRET };
