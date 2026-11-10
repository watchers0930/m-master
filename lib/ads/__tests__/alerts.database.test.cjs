/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, __dirname, process, console, setTimeout, Response, AbortSignal */
// 광고 감시 이메일 알림 — 실DB(PGlite): (계정·유형·KST 날짜) 1회, 재시도·상한 5회, env 누락 시 대기, 동시 flush 1회 발송, 키 비노출.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path'), util = require('node:util');
const { execFileSync } = require('node:child_process'), { createRequire } = require('node:module');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;
const KEY = 're_test_SECRET_9f8e7d6c5b4a';
const FROM = 'MINTEQ 알림 <alerts@minteq.test>';
const T0 = new Date('2026-11-10T03:00:00Z'); // KST 12:00
const at = (ms) => () => new Date(T0.getTime() + ms);
const MIN = 60_000;

function fakeTransport({ fail = () => null, delayMs = 0 } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const f = fail(calls.length);
    if (f instanceof Error) throw f;
    if (f) return new Response(f.body ?? '{}', { status: f.status });
    return new Response(JSON.stringify({ id: `email-${calls.length}` }), { status: 200 });
  };
  return { fn, calls };
}
const leaks = (v) => [JSON.stringify(v), String(v), util.inspect(v, { depth: 8, showHidden: true })].some((s) => s.includes(KEY) || s.includes('9f8e7d6c5b4a'));

test('ads alert email on a real database', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async (t) => {
  const runtime = createRequire(path.join(packageDir, 'package.json'));
  const { PGlite } = runtime('@electric-sql/pglite'), { PGLiteSocketServer } = runtime('@electric-sql/pglite-socket');
  const { PrismaClient } = require('@prisma/client'), root = path.resolve(__dirname, '../../..');
  const db = await PGlite.create(); let server, client;
  const warn = console.warn; console.warn = () => {};
  try {
    const ddl = execFileSync(path.join(root, 'node_modules/.bin/prisma'), ['migrate', 'diff', '--from-empty', '--to-schema-datamodel', path.join(root, 'prisma/schema.prisma'), '--script'], { encoding: 'utf8' })
      .replace(/CREATE EXTENSION[^;]*;/g, '').replace(/vector\(1536\)/g, 'TEXT');
    await db.exec(ddl);
    await db.exec(`INSERT INTO users(id,email,password_hash,updated_at) VALUES ('owner','owner@minteq.test','unused',now()),('other','other@minteq.test','unused',now()),('blank','','unused',now())`);
    const acc = (id, owner, cust) => db.exec(`INSERT INTO ad_accounts(id,owner_id,naver_customer_id,label,api_key_enc,secret_key_enc,key_last4,updated_at) VALUES ('${id}','${owner}','${cust}','베스트라 광고','enc','enc','abcd',now())`);
    await acc('acc1', 'owner', '111'); await acc('acc2', 'other', '222'); await acc('acc-blank', 'blank', '333');
    server = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1' }); await server.start();
    let address = server.getServerConn(); if (!address.startsWith('postgres')) address = 'postgresql://postgres:postgres@' + address + '/postgres';
    client = new PrismaClient({ datasources: { db: { url: address + (address.includes('?') ? '&' : '?') + 'connection_limit=1&sslmode=disable' } } });
    require.cache[require.resolve('../../prisma.ts')] = { exports: { prisma: client } };
    const alerts = require('../alerts.ts');
    const email = require('../../notify/email.ts');
    const { queueAlert, flushAlerts, kstDate, MAX_ATTEMPTS, CLAIM_TIMEOUT_MS } = alerts;
    const setEnv = () => Object.assign(process.env, { RESEND_API_KEY: KEY, ADS_ALERT_FROM: FROM });
    setEnv();
    const rows = async () => (await db.query('SELECT id,owner_id,ad_account_id,type,kst_date,sent_at,attempts,last_error,claimed_at FROM ad_alerts ORDER BY created_at,id')).rows;
    const reset = () => db.exec('DELETE FROM ad_alerts');

    await t.test('kst date flips at 15:00Z (KST midnight), not at server-local midnight', () => {
      assert.equal(kstDate(new Date('2026-11-10T14:59:59.999Z')), '2026-11-10');
      assert.equal(kstDate(new Date('2026-11-10T15:00:00.000Z')), '2026-11-11');
      assert.equal(kstDate(new Date('2026-12-31T15:00:00Z')), '2027-01-01');
    });

    await t.test('same alert same day sent once', async () => {
      const tr = fakeTransport();
      await queueAlert('acc1', 'ads.cap_90', { spentKrw: 90000, capKrw: 100000 }, { now: () => new Date('2026-11-10T14:59:59Z') });
      await queueAlert('acc1', 'ads.cap_90', { spentKrw: 95000, capKrw: 100000 }, { now: () => new Date('2026-11-10T00:00:00Z') });
      await queueAlert('acc1', 'ads.cap_90', { spentKrw: 1000, capKrw: 100000 }, { now: () => new Date('2026-11-10T15:00:00Z') }); // KST 다음 날
      const r = await rows();
      assert.deepEqual(r.map((x) => [x.owner_id, x.kst_date]), [['owner', '2026-11-10'], ['owner', '2026-11-11']]);
      assert.deepEqual(await flushAlerts(20, { transport: tr.fn, now: at(0) }), { sent: 2, failed: 0 });
      assert.deepEqual(await flushAlerts(20, { transport: tr.fn, now: at(MIN) }), { sent: 0, failed: 0 });
      assert.equal(tr.calls.length, 2);
      const c = tr.calls[0];
      assert.equal(c.url, 'https://api.resend.com/emails');
      assert.equal(c.init.method, 'POST');
      assert.equal(c.init.redirect, 'error');
      assert.ok(c.init.signal instanceof AbortSignal);
      assert.equal(c.init.headers.Authorization, `Bearer ${KEY}`);
      assert.equal(c.init.headers['Idempotency-Key'], r[0].id, 'idempotency key = alert id');
      assert.deepEqual(Object.keys(c.body).sort(), ['from', 'subject', 'text', 'to']);
      assert.deepEqual(c.body.to, ['owner@minteq.test']);
      assert.equal(c.body.from, FROM);
      assert.match(c.body.subject, /^\[MINTEQ 광고\] .*90%/);
      assert.match(c.body.text, /베스트라 광고/);
      assert.match(c.body.text, /90,000/, 'first payload kept on duplicate queue');
      // 발송 후 같은 날 다시 요청해도 sentAt·attempts는 그대로
      const before = (await rows())[0];
      await queueAlert('acc1', 'ads.cap_90', { spentKrw: 99999 }, { now: () => new Date('2026-11-10T10:00:00Z') });
      const after = (await rows())[0];
      assert.ok(before.sent_at && after.sent_at.getTime() === before.sent_at.getTime());
      assert.equal(after.attempts, 1);
      assert.equal(after.claimed_at, null);
      await reset();
    });

    await t.test('ownerId always comes from the AdAccount row; unknown account or type is rejected', async () => {
      await queueAlert('acc2', 'ads.drift', { field: 'useExpSearch' }, { now: at(0) });
      assert.equal((await rows())[0].owner_id, 'other');
      await assert.rejects(queueAlert('nope', 'ads.drift', {}, { now: at(0) }), /ad_account_not_found/);
      await assert.rejects(queueAlert('acc1', 'ads.unknown', {}, { now: at(0) }), /invalid_alert_type/);
      await assert.rejects(queueAlert('acc1', 'ads.drift', { big: 'x'.repeat(5000) }, { now: at(0) }), /alert_payload_too_large/);
      for (const bad of [{ secretKey: 'x' }, { nested: { apiKey: 'x' } }, { accessToken: 'x' }]) await assert.rejects(queueAlert('acc1', 'ads.drift', bad, { now: at(0) }), /alert_payload_forbidden_key/);
      await assert.rejects(queueAlert('acc1', 'ads.drift', ['x'], { now: at(0) }), /invalid_alert_payload/);
      const tr = fakeTransport();
      await flushAlerts(20, { transport: tr.fn, now: at(0) });
      assert.deepEqual(tr.calls[0].body.to, ['other@minteq.test']);
      await reset();
    });

    await t.test('failed send retried next flush', async () => {
      const tr = fakeTransport({ fail: (n) => (n === 1 ? { status: 500, body: `{"message":"bad key ${KEY}"}` } : null) });
      await queueAlert('acc1', 'ads.key_invalid', {}, { now: at(0) });
      assert.deepEqual(await flushAlerts(20, { transport: tr.fn, now: at(0) }), { sent: 0, failed: 1 });
      let r = (await rows())[0];
      assert.deepEqual([r.attempts, r.last_error, r.sent_at, r.claimed_at], [1, 'resend_http_500', null, null]);
      assert.ok(!leaks(r));
      assert.deepEqual(await flushAlerts(20, { transport: tr.fn, now: at(MIN) }), { sent: 1, failed: 0 });
      r = (await rows())[0];
      assert.deepEqual([r.attempts, r.last_error], [2, null]);
      assert.ok(r.sent_at);
      assert.equal(tr.calls[0].init.headers['Idempotency-Key'], tr.calls[1].init.headers['Idempotency-Key'], 'retry reuses the key');
      await reset();
    });

    await t.test(`attempts stop at ${MAX_ATTEMPTS}`, async () => {
      assert.equal(MAX_ATTEMPTS, 5);
      const tr = fakeTransport({ fail: () => new Error('network down') });
      await queueAlert('acc1', 'ads.bizmoney_low', { bizmoneyKrw: 1000 }, { now: at(0) });
      for (let i = 0; i < 8; i++) await flushAlerts(20, { transport: tr.fn, now: at(i * MIN) });
      const r = (await rows())[0];
      assert.equal(tr.calls.length, 5);
      assert.deepEqual([r.attempts, r.last_error, r.sent_at], [5, 'resend_network', null]);
      await reset();
    });

    await t.test('missing env leaves alert queued', async () => {
      const tr = fakeTransport();
      await queueAlert('acc1', 'ads.cap_100', { spentKrw: 100000 }, { now: at(0) });
      for (const name of ['RESEND_API_KEY', 'ADS_ALERT_FROM']) {
        setEnv(); delete process.env[name];
        assert.deepEqual(await flushAlerts(20, { transport: tr.fn, now: at(0) }), { sent: 0, failed: 1 });
        await assert.rejects(email.sendEmail({ to: 'owner@minteq.test', subject: 's', text: 't' }, { transport: tr.fn }), /email_not_configured/);
      }
      setEnv(); process.env.RESEND_API_KEY = '   ';
      await flushAlerts(20, { transport: tr.fn, now: at(0) });
      const r = (await rows())[0];
      assert.equal(tr.calls.length, 0);
      assert.deepEqual([r.attempts, r.last_error, r.sent_at, r.claimed_at], [0, 'email_not_configured', null, null]);
      setEnv();
      assert.deepEqual(await flushAlerts(20, { transport: tr.fn, now: at(MIN) }), { sent: 1, failed: 0 });
      await reset();
    });

    await t.test('owner without a usable email stays queued as no_recipient without using attempts', async () => {
      const tr = fakeTransport();
      await queueAlert('acc-blank', 'ads.drift', {}, { now: at(0) });
      for (let i = 0; i < 7; i++) assert.deepEqual(await flushAlerts(20, { transport: tr.fn, now: at(i * MIN) }), { sent: 0, failed: 1 });
      const r = (await rows())[0];
      assert.equal(tr.calls.length, 0);
      assert.deepEqual([r.attempts, r.last_error, r.sent_at], [0, 'no_recipient', null]);
      await reset();
    });

    await t.test('two concurrent flushes send each alert exactly once', async () => {
      const tr = fakeTransport({ delayMs: 30 });
      const types = ['ads.key_invalid', 'ads.cap_90', 'ads.cap_100', 'ads.auto_resume', 'ads.drift', 'ads.inspect_denied', 'ads.bizmoney_low'];
      for (const ty of types) await queueAlert('acc1', ty, { n: 1 }, { now: at(0) });
      const [a, b] = await Promise.all([flushAlerts(20, { transport: tr.fn, now: at(0) }), flushAlerts(20, { transport: tr.fn, now: at(0) })]);
      assert.equal(a.sent + b.sent, types.length);
      assert.equal(a.failed + b.failed, 0);
      assert.equal(tr.calls.length, types.length);
      assert.equal(new Set(tr.calls.map((c) => c.init.headers['Idempotency-Key'])).size, types.length);
      assert.ok((await rows()).every((r) => r.sent_at && r.attempts === 1));
      await reset();
    });

    await t.test(`stuck claim (runner died) becomes retryable after ${CLAIM_TIMEOUT_MS / MIN} minutes`, async () => {
      assert.equal(CLAIM_TIMEOUT_MS, 5 * MIN);
      const tr = fakeTransport();
      await queueAlert('acc1', 'ads.auto_resume', {}, { now: at(0) });
      await db.exec(`UPDATE ad_alerts SET claimed_at='${T0.toISOString()}', attempts=1`); // 발송 직전에 죽은 실행
      assert.deepEqual(await flushAlerts(20, { transport: tr.fn, now: at(5 * MIN - 1) }), { sent: 0, failed: 0 });
      assert.equal(tr.calls.length, 0);
      assert.deepEqual(await flushAlerts(20, { transport: tr.fn, now: at(5 * MIN) }), { sent: 1, failed: 0 });
      const r = (await rows())[0];
      assert.deepEqual([r.attempts, r.claimed_at], [2, null]);
      // 죽은 실행도 시도 횟수에 들어가므로, 5번째 claim 후 죽은 알림은 더 이상 잡지 않는다
      await reset();
      await queueAlert('acc1', 'ads.auto_resume', {}, { now: at(0) });
      await db.exec(`UPDATE ad_alerts SET claimed_at='${T0.toISOString()}', attempts=5`);
      assert.deepEqual(await flushAlerts(20, { transport: tr.fn, now: at(60 * MIN) }), { sent: 0, failed: 0 });
      assert.equal(tr.calls.length, 1);
      await reset();
    });

    await t.test('flush is oldest first and honours limit', async () => {
      const tr = fakeTransport();
      for (const [ty, ts] of [['ads.drift', '2026-11-10T03:00:03Z'], ['ads.cap_90', '2026-11-10T03:00:01Z'], ['ads.cap_100', '2026-11-10T03:00:02Z']]) {
        await queueAlert('acc1', ty, {}, { now: at(0) });
        await db.exec(`UPDATE ad_alerts SET created_at='${ts}' WHERE type='${ty}'`);
      }
      assert.deepEqual(await flushAlerts(2, { transport: tr.fn, now: at(0) }), { sent: 2, failed: 0 });
      assert.deepEqual(tr.calls.map((c) => c.body.subject.includes('100%') ? 'cap_100' : c.body.subject.includes('90%') ? 'cap_90' : 'other'), ['cap_90', 'cap_100']);
      await assert.rejects(flushAlerts(0, { transport: tr.fn }), /invalid_limit/);
      await reset();
    });

    await t.test('sendEmail never exposes the API key and strips header injection', async () => {
      const boom = new Error(`connect failed Authorization: Bearer ${KEY}`);
      for (const fail of [() => boom, () => ({ status: 401, body: `{"message":"${KEY}"}` })]) {
        const tr = fakeTransport({ fail });
        const err = await email.sendEmail({ to: 'owner@minteq.test', subject: 's', text: 't' }, { transport: tr.fn, idempotencyKey: 'k1' }).then(() => null, (e) => e);
        assert.ok(err instanceof Error);
        assert.match(err.message, /^resend_(network|http_401)$/);
        assert.equal(err.cause, undefined);
        assert.ok(!leaks(err), 'JSON.stringify / String / util.inspect');
      }
      const timeout = fakeTransport({ fail: () => Object.assign(new Error('aborted'), { name: 'TimeoutError' }) });
      await assert.rejects(email.sendEmail({ to: 'owner@minteq.test', subject: 's', text: 't' }, { transport: timeout.fn }), /^EmailError: resend_timeout$/);
      const tr = fakeTransport();
      await email.sendEmail({ to: 'owner@minteq.test', subject: `제목\r\nBcc: evil@x.test\u2028${'가'.repeat(400)}`, text: `본문\r\n둘째 줄\u0000${'나'.repeat(20000)}` }, { transport: tr.fn });
      const { subject, text } = tr.calls[0].body;
      // eslint-disable-next-line no-control-regex -- asserting control chars are gone.
      assert.doesNotMatch(subject, /[\r\n\u2028\u0000]/);
      assert.ok(subject.length <= email.MAX_SUBJECT_CHARS);
      assert.ok(text.length <= email.MAX_TEXT_CHARS);
      assert.match(text, /^본문\n둘째 줄/);
      // eslint-disable-next-line no-control-regex -- asserting control chars are gone.
      assert.doesNotMatch(text, /[\r\u0000]/);
      assert.equal(tr.calls[0].init.headers['Idempotency-Key'], undefined, 'no key header when none given');
      await assert.rejects(email.sendEmail({ to: 'a@b.test\r\nBcc: x@y.test', subject: 's', text: 't' }, { transport: tr.fn }), /invalid_recipient/);
      await assert.rejects(email.sendEmail({ to: '', subject: 's', text: 't' }, { transport: tr.fn }), /invalid_recipient/);
    });
  } finally {
    console.warn = warn;
    await client?.$disconnect(); await server?.stop(); await db.close();
  }
});
