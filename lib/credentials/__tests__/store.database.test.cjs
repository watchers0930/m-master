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
const OTHER = Buffer.alloc(32, 9).toString('base64');
const ctx = (field, ownerId, channel) => `channel_credentials.${field}:${ownerId}:${channel}`;

test('channel credential store on a real database', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async (t) => {
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
    const crypto = require('../../crypto/credentials.ts');
    const { decryptSecret, encryptSecret, credentialKeyId } = crypto;
    const useSecret = (secret) => { process.env.CREDENTIAL_ENCRYPTION_SECRET = secret; process.env.CREDENTIAL_KEY_ID = credentialKeyId(); };
    useSecret(SECRET);
    const KID = credentialKeyId();
    // 다른 환경(다른 키)으로 쓴 암호문을 만든다
    const foreignBlob = (plain, context) => { useSecret(OTHER); try { return encryptSecret(plain, context); } finally { useSecret(SECRET); } };

    await t.test('listMasked is owner-scoped', async () => {
      await store.writeChannelCredential('tenant-a', 'instagram', { accessToken: 'tenant-a-token-AAAA', meta: { businessId: 'biz-a-000001' } });
      await store.writeChannelCredential('tenant-b', 'instagram', { accessToken: 'tenant-b-token-BBBB', meta: { businessId: 'biz-b-000002' } });
      await store.writeChannelCredential('tenant-a', 'ga4', { refreshToken: 'ga4-refresh-GGGG', meta: { client_id: 'g', client_secret: 'ga4-secret-0000' } });
      const a = await store.listMaskedCredentials('tenant-a');
      assert.deepEqual(Object.keys(a), ['instagram'], 'ga4는 채널 연동 목록에서 제외');
      assert.equal(a.instagram.connected, true);
      assert.equal(a.instagram.masked.accessToken, '••••AAAA', '복호화한 평문을 마스킹(암호문 마스킹 금지)');
      assert.ok(!JSON.stringify(a).includes('BBBB') && !JSON.stringify(a).includes('v1:'));
      assert.deepEqual(await store.listMaskedCredentials('nobody'), {});
      await db.exec(`DELETE FROM channel_credentials WHERE channel='ga4'`);
    });

    await t.test('listMasked shows an undecryptable row as a key error, never masked ciphertext, never disconnected', async () => {
      const blob = foreignBlob('foreign-token-ZZZZ', ctx('access_token', 'tenant-a', 'facebook'));
      await db.exec(`INSERT INTO channel_credentials(id,owner_id,channel,access_token,meta,updated_at) VALUES ('fb-bad','tenant-a','facebook','${blob}','{"pageId":"page-1"}',now())`);
      const original = console.error, logged = [];
      console.error = (...args) => logged.push(args);
      let a;
      try { a = await store.listMaskedCredentials('tenant-a'); } finally { console.error = original; }
      assert.deepEqual(a.facebook, { connected: true, error: 'decrypt_failed', masked: {} });
      assert.equal(a.instagram.masked.accessToken, '••••AAAA', '다른 행은 정상 표시');
      assert.ok(!JSON.stringify(a).includes(blob.slice(-4)) && !JSON.stringify(a).includes('v1:'));
      assert.deepEqual(logged, [['[credentials] decrypt failed', { channel: 'facebook', reason: 'key_mismatch' }]]);
      await db.exec(`DELETE FROM channel_credentials WHERE id='fb-bad'`);
    });

    await t.test('channels page shows only own rows; env status only for the platform owner', async () => {
      const { channelsInitialState } = require('../channels-view.ts');
      const { getCafeTargets } = require('../../channel-credentials.ts');
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
        // 카페 타겟은 ownerId 필수 — 전체 조회 경로 없음
        await assert.rejects(getCafeTargets(''), /ownerId required/);
        await assert.rejects(getCafeTargets(undefined), /ownerId required/);
        assert.deepEqual((await getCafeTargets('tenant-b')).map(c => c.name), ['B카페']);
      } finally {
        delete process.env.NAVER_CAFE_ACCESS_TOKEN; delete process.env.NAVER_CAFE_CLUB_ID; delete process.env.NAVER_CAFE_MENU_ID;
      }
    });

    const { backfillChannelCredentials, BackfillAbort } = require('../backfill.ts');
    const legacyRows = async () => {
      await db.exec(`INSERT INTO channel_credentials(id,owner_id,channel,access_token,refresh_token,meta,updated_at) VALUES
        ('legacy-ga4','first','ga4','ga4-access-plain','ga4-refresh-plain','{"client_id":"gcid","client_secret":"ga4-secret-plain","n":5}','2020-05-05T00:00:00Z'),
        ('legacy-cafe','tenant-a','naver_cafe','cafe-access-plain',NULL,'{"clientId":"ncid","clientSecret":"","clubId":"11","menuId":"22"}','2020-05-05T00:00:00Z')`);
    };
    const snapshot = async () => (await db.query(`SELECT id,access_token,refresh_token,meta,updated_at FROM channel_credentials ORDER BY id`)).rows;
    const reset = async () => { await db.exec(`DELETE FROM channel_credentials WHERE id LIKE 'legacy-%' OR id LIKE 'mixed-%'`); await legacyRows(); };
    // 백필 트랜잭션 계측: tx 안의 SQL 기록, UPDATE 파라미터 변조, 트랜잭션 직전 동시 쓰기 주입
    const instrument = ({ mutateUpdate, beforeTx } = {}) => {
      const original = client.$transaction.bind(client), log = { querySql: [], executeCount: 0 };
      client.$transaction = async (fn, ...rest) => {
        if (beforeTx) await beforeTx();
        return original(tx => fn(new Proxy(tx, { get(target, prop) {
          if (prop === '$queryRaw') return (strings, ...values) => { log.querySql.push(strings.join('?')); return target.$queryRaw(strings, ...values); };
          if (prop === '$executeRaw') return (strings, ...values) => { log.executeCount++; return target.$executeRaw(strings, ...(mutateUpdate ? mutateUpdate(values) : values)); };
          const value = target[prop]; return typeof value === 'function' ? value.bind(target) : value;
        } })), ...rest);
      };
      return { log, restore: () => { client.$transaction = original; } };
    };

    await t.test('backfill dry-run writes nothing', async () => {
      await legacyRows();
      const before = await snapshot();
      const report = await backfillChannelCredentials(client, { apply: false, expectKid: KID });
      assert.deepEqual(await snapshot(), before);
      assert.equal(report.apply, false);
      assert.equal(report.updatedRows, 0);
      assert.deepEqual(report.legacy, { ga4: { accessToken: 1, refreshToken: 1, 'meta.client_secret': 1 }, naver_cafe: { accessToken: 1 } });
      assert.deepEqual(report.unreadable, {});
      assert.ok(!JSON.stringify(report).includes('plain'));
    });

    await t.test('backfill aborts before any write on a wrong or malformed --expect-kid', async () => {
      const before = await snapshot();
      const wrong = KID.replace(/^./, c => (c === '0' ? '1' : '0'));
      await assert.rejects(backfillChannelCredentials(client, { apply: true, expectKid: wrong }), e => e instanceof BackfillAbort && e.code === 'expect_kid_mismatch');
      for (const bad of ['', 'xyz', KID.toUpperCase(), KID + '0', undefined]) {
        await assert.rejects(backfillChannelCredentials(client, { apply: true, expectKid: bad }), e => e instanceof BackfillAbort && e.code === 'expect_kid_invalid');
      }
      assert.deepEqual(await snapshot(), before);
    });

    await t.test('backfill apply verifies round trip and is idempotent (row lock, updated_at kept)', async () => {
      const all = await snapshot();
      const sealedBefore = all.filter(r => r.id !== 'legacy-ga4' && r.id !== 'legacy-cafe');
      const ga4Updated = all.find(r => r.id === 'legacy-ga4').updated_at.getTime();
      const probe = instrument();
      let report;
      try { report = await backfillChannelCredentials(client, { apply: true, expectKid: KID }); } finally { probe.restore(); }
      assert.equal(report.updatedRows, 2);
      // 행별 트랜잭션 안의 모든 조회는 잠금 조회여야 한다(FOR UPDATE 제거 회귀 방지)
      assert.ok(probe.log.querySql.length >= 4);
      assert.ok(probe.log.querySql.every(sql => /FOR UPDATE/.test(sql)), 'sealRow 조회는 FOR UPDATE');
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
      assert.deepEqual((await snapshot()).filter(r => r.id !== 'legacy-ga4' && r.id !== 'legacy-cafe'), sealedBefore, '이미 암호화된 행은 그대로');
      const read = await store.readChannelCredential('first', 'ga4');
      assert.equal(read.refreshToken, 'ga4-refresh-plain');
      assert.equal(read.meta.client_secret, 'ga4-secret-plain');
      const after = await snapshot();
      const again = await backfillChannelCredentials(client, { apply: true, expectKid: KID });
      assert.equal(again.updatedRows, 0);
      assert.deepEqual(again.legacy, {});
      assert.deepEqual(await snapshot(), after);
    });

    await t.test('mixed-key existing ciphertext aborts apply with zero writes (counts only)', async () => {
      await reset();
      const otherKey = foreignBlob('foreign-access-1', ctx('access_token', 'tenant-b', 'facebook'));
      const movedBlob = encryptSecret('moved-access-1', ctx('access_token', 'tenant-a', 'instagram')); // 다른 행 context로 쓴 값
      await db.exec(`INSERT INTO channel_credentials(id,owner_id,channel,access_token,meta,updated_at) VALUES
        ('mixed-fb','tenant-b','facebook','${otherKey}','{"pageId":"p"}',now()),
        ('mixed-ig','first','instagram','${movedBlob}','{"businessId":"b"}',now())`);
      const before = await snapshot();
      const dry = await backfillChannelCredentials(client, { apply: false, expectKid: KID });
      assert.deepEqual(dry.unreadable, { facebook: { key_mismatch: 1 }, instagram: { invalid_blob: 1 } });
      const probe = instrument();
      try {
        await assert.rejects(backfillChannelCredentials(client, { apply: true, expectKid: KID }), e => {
          assert.ok(e instanceof BackfillAbort);
          assert.equal(e.code, 'existing_ciphertext_unreadable');
          assert.deepEqual(e.unreadable, { facebook: { key_mismatch: 1 }, instagram: { invalid_blob: 1 } });
          assert.ok(!JSON.stringify(e).includes('foreign') && !String(e.message).includes('v1:'));
          return true;
        });
      } finally { probe.restore(); }
      assert.equal(probe.log.executeCount, 0);
      assert.deepEqual(await snapshot(), before, '평문 행도 하나도 바뀌지 않는다');
      await db.exec(`DELETE FROM channel_credentials WHERE id LIKE 'mixed-%'`);
    });

    await t.test('round-trip verify runs before UPDATE: a corrupted encrypt issues no write', async () => {
      await reset();
      const before = await snapshot();
      const realEncrypt = crypto.encryptSecret;
      crypto.encryptSecret = (plain, context) => realEncrypt(plain + '-corrupted', context);
      const probe = instrument();
      try {
        await assert.rejects(backfillChannelCredentials(client, { apply: true, expectKid: KID }), e => e instanceof BackfillAbort && e.code === 'verify_failed');
      } finally { probe.restore(); crypto.encryptSecret = realEncrypt; }
      assert.equal(probe.log.executeCount, 0, '검증 실패 시 UPDATE를 보내지 않는다');
      assert.deepEqual(await snapshot(), before);
    });

    await t.test('post-update re-read catches a stored value that differs and rolls back', async () => {
      await reset();
      const before = await snapshot();
      // DB에 실제로 저장되는 값이 검증한 값과 달라지는 상황(드라이버·트리거 변형)을 흉내낸다
      const probe = instrument({ mutateUpdate: values => values.map(v => (typeof v === 'string' && v.startsWith('v1:') ? encryptSecret('tampered-value', ctx('access_token', 'first', 'ga4')) : v)) });
      try {
        await assert.rejects(backfillChannelCredentials(client, { apply: true, expectKid: KID }), e => e instanceof BackfillAbort && e.code === 'verify_failed');
      } finally { probe.restore(); }
      assert.ok(probe.log.executeCount >= 1);
      assert.deepEqual(await snapshot(), before, '트랜잭션 롤백 — 변조 값이 남지 않는다');
    });

    await t.test('concurrent writer between scan and seal: the locked re-read value is what gets sealed', async () => {
      await reset();
      let injected = false;
      const probe = instrument({ beforeTx: async () => {
        if (injected) return; injected = true;
        // 스캔 이후·잠금 전에 (구버전 배포 등) 다른 쓰기가 평문 새 값을 넣었다
        await db.exec(`UPDATE channel_credentials SET access_token='newer-access-plain' WHERE id='legacy-cafe'`);
      } });
      try { await backfillChannelCredentials(client, { apply: true, expectKid: KID }); } finally { probe.restore(); }
      const [cafe] = (await db.query(`SELECT access_token FROM channel_credentials WHERE id='legacy-cafe'`)).rows;
      assert.equal(decryptSecret(cafe.access_token, ctx('access_token', 'tenant-a', 'naver_cafe')), 'newer-access-plain', '스캔 시점 값으로 덮어쓰지 않는다');
    });

    await t.test('backfill refuses to run without a valid key or key id', async () => {
      delete process.env.CREDENTIAL_ENCRYPTION_SECRET;
      try {
        await assert.rejects(backfillChannelCredentials(client, { apply: false, expectKid: KID }), e => e.reason === 'not_configured');
        useSecret(SECRET); delete process.env.CREDENTIAL_KEY_ID;
        await assert.rejects(backfillChannelCredentials(client, { apply: false, expectKid: KID }), e => e.reason === 'not_configured');
      } finally { useSecret(SECRET); }
    });
  } finally { console.warn = warn; await client?.$disconnect(); await server?.stop(); await db.close(); }
});
