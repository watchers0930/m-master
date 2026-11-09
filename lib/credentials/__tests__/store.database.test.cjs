/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, __dirname, process, Buffer, console */
// 실DB(PGlite): 목록 테넌트 격리, 채널 화면 env 표시는 플랫폼 오너만, 평문→암호문 백필(dry-run 무쓰기·검증·멱등).
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process'), { createRequire } = require('node:module');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;
const SECRET = Buffer.alloc(32, 7).toString('base64');
const ctx = (field, ownerId, channel) => `channel_credentials.${field}:${ownerId}:${channel}`;

test('channel credential store on a real database', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async (t) => {
  process.env.CREDENTIAL_ENCRYPTION_SECRET = SECRET;
  const runtime = createRequire(path.join(packageDir, 'package.json'));
  const { PGlite } = runtime('@electric-sql/pglite'), { PGLiteSocketServer } = runtime('@electric-sql/pglite-socket');
  const { PrismaClient } = require('@prisma/client'), root = path.resolve(__dirname, '../../..');
  const db = await PGlite.create(); let server, client;
  const warn = console.warn; console.warn = () => {};
  try {
    const ddl = execFileSync(path.join(root, 'node_modules/.bin/prisma'), ['migrate', 'diff', '--from-empty', '--to-schema-datamodel', path.join(root, 'prisma/schema.prisma'), '--script'], { encoding: 'utf8' })
      .replace(/CREATE EXTENSION[^;]*;/g, '').replace(/vector\(1536\)/g, 'TEXT');
    await db.exec(ddl);
    await db.exec(`INSERT INTO users(id,email,password_hash,created_at,updated_at) VALUES
      ('first','first@test','unused','2020-01-01',now()),('tenant-a','a@test','unused','2021-01-01',now()),('tenant-b','b@test','unused','2022-01-01',now())`);
    server = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1' }); await server.start();
    let address = server.getServerConn(); if (!address.startsWith('postgres')) address = 'postgresql://postgres:postgres@' + address + '/postgres';
    client = new PrismaClient({ datasources: { db: { url: address + (address.includes('?') ? '&' : '?') + 'connection_limit=1&sslmode=disable' } } });
    require.cache[require.resolve('../../prisma.ts')] = { exports: { prisma: client } };
    const store = require('../store.ts');
    const { decryptSecret } = require('../../crypto/credentials.ts');

    await t.test('listMasked is owner-scoped', async () => {
      await store.writeChannelCredential('tenant-a', 'instagram', { accessToken: 'tenant-a-token-AAAA', meta: { businessId: 'biz-a-000001' } });
      await store.writeChannelCredential('tenant-b', 'instagram', { accessToken: 'tenant-b-token-BBBB', meta: { businessId: 'biz-b-000002' } });
      const a = await store.listMaskedCredentials('tenant-a');
      assert.deepEqual(Object.keys(a), ['instagram']);
      assert.equal(a.instagram.connected, true);
      assert.equal(a.instagram.masked.accessToken, '••••AAAA', '복호화한 평문을 마스킹(암호문 마스킹 금지)');
      assert.ok(!JSON.stringify(a).includes('BBBB') && !JSON.stringify(a).includes('v1:'));
      assert.deepEqual(await store.listMaskedCredentials('nobody'), {});
    });

    await t.test('channels page shows only own rows; env status only for the platform owner', async () => {
      const { channelsInitialState } = require('../channels-view.ts');
      Object.assign(process.env, { NAVER_CAFE_ACCESS_TOKEN: 'env-naver-token-ENVV', NAVER_CAFE_CLUB_ID: 'club-env-1', NAVER_CAFE_MENU_ID: 'menu-env-1' });
      await client.cafeTarget.createMany({ data: [{ ownerId: 'tenant-a', name: 'A카페', clubId: '1', menuId: '2' }, { ownerId: 'tenant-b', name: 'B카페', clubId: '3', menuId: '4' }] });
      try {
        const a = await channelsInitialState('tenant-a');
        assert.deepEqual(Object.keys(a.initial), ['instagram'], '다른 테넌트 행·플랫폼 env는 보이지 않는다');
        assert.ok(!JSON.stringify(a).includes('BBBB'));
        assert.deepEqual(a.cafeTargets.map(c => c.name), ['A카페']);
        const owner = await channelsInitialState('first');
        assert.equal(owner.initial.naver_cafe.connected, true);
        assert.equal(owner.initial.naver_cafe.masked.accessToken, '••••ENVV');
        assert.equal(owner.initial.instagram, undefined);
      } finally {
        delete process.env.NAVER_CAFE_ACCESS_TOKEN; delete process.env.NAVER_CAFE_CLUB_ID; delete process.env.NAVER_CAFE_MENU_ID;
      }
    });

    const { backfillChannelCredentials } = require('../backfill.ts');
    const legacyRows = async () => {
      await db.exec(`INSERT INTO channel_credentials(id,owner_id,channel,access_token,refresh_token,meta,updated_at) VALUES
        ('legacy-ga4','first','ga4','ga4-access-plain','ga4-refresh-plain','{"client_id":"gcid","client_secret":"ga4-secret-plain","n":5}','2020-05-05T00:00:00Z'),
        ('legacy-cafe','tenant-a','naver_cafe','cafe-access-plain',NULL,'{"clientId":"ncid","clientSecret":"","clubId":"11","menuId":"22"}','2020-05-05T00:00:00Z')`);
    };
    const snapshot = async () => (await db.query(`SELECT id,access_token,refresh_token,meta,updated_at FROM channel_credentials ORDER BY id`)).rows;

    await t.test('backfill dry-run writes nothing', async () => {
      await legacyRows();
      const before = await snapshot();
      const report = await backfillChannelCredentials(client, { apply: false });
      assert.deepEqual(await snapshot(), before);
      assert.equal(report.apply, false);
      assert.equal(report.updatedRows, 0);
      assert.deepEqual(report.legacy, { ga4: { accessToken: 1, refreshToken: 1, 'meta.client_secret': 1 }, naver_cafe: { accessToken: 1 } });
      assert.ok(!JSON.stringify(report).includes('plain'));
    });

    await t.test('backfill apply verifies round trip and is idempotent', async () => {
      const all = await snapshot();
      const sealedBefore = all.filter(r => r.id !== 'legacy-ga4' && r.id !== 'legacy-cafe');
      const ga4Updated = all.find(r => r.id === 'legacy-ga4').updated_at.getTime();
      const report = await backfillChannelCredentials(client, { apply: true });
      assert.equal(report.updatedRows, 2);
      const [cafe, ga4] = (await db.query(`SELECT id,access_token,refresh_token,meta,updated_at FROM channel_credentials WHERE id IN ('legacy-cafe','legacy-ga4') ORDER BY id`)).rows;
      assert.equal(decryptSecret(ga4.access_token, ctx('access_token', 'first', 'ga4')), 'ga4-access-plain');
      assert.equal(decryptSecret(ga4.refresh_token, ctx('refresh_token', 'first', 'ga4')), 'ga4-refresh-plain');
      assert.equal(decryptSecret(ga4.meta.client_secret, ctx('meta.client_secret', 'first', 'ga4')), 'ga4-secret-plain');
      assert.deepEqual({ id: ga4.meta.client_id, n: ga4.meta.n }, { id: 'gcid', n: 5 }, '식별자·비문자열 meta는 그대로');
      assert.equal(ga4.updated_at.getTime(), ga4Updated, '백필은 updated_at을 바꾸지 않는다');
      assert.equal(decryptSecret(cafe.access_token, ctx('access_token', 'tenant-a', 'naver_cafe')), 'cafe-access-plain');
      assert.equal(cafe.refresh_token, null);
      assert.equal(cafe.meta.clientSecret, '', '빈 값은 비밀이 아니므로 그대로');
      assert.equal(cafe.meta.clubId, '11');
      // 이미 암호화된 행은 건드리지 않음
      assert.deepEqual((await snapshot()).filter(r => r.id !== 'legacy-ga4' && r.id !== 'legacy-cafe'), sealedBefore);
      // 저장소로 읽으면 원문
      const read = await store.readChannelCredential('first', 'ga4');
      assert.equal(read.refreshToken, 'ga4-refresh-plain');
      assert.equal(read.meta.client_secret, 'ga4-secret-plain');
      const after = await snapshot();
      const again = await backfillChannelCredentials(client, { apply: true });
      assert.equal(again.updatedRows, 0);
      assert.deepEqual(again.legacy, {});
      assert.deepEqual(await snapshot(), after);
    });

    await t.test('backfill refuses to run without a valid key', async () => {
      delete process.env.CREDENTIAL_ENCRYPTION_SECRET;
      try {
        await assert.rejects(backfillChannelCredentials(client, { apply: false }), e => e.reason === 'not_configured');
      } finally { process.env.CREDENTIAL_ENCRYPTION_SECRET = SECRET; }
    });
  } finally { console.warn = warn; await client?.$disconnect(); await server?.stop(); await db.close(); }
});
