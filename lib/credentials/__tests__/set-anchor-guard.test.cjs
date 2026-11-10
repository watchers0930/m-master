/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process, __dirname */
// scripts/crypto/set-anchor.ts는 운영 DB에 쓰지 못한다: --non-production 플래그 + 운영 DB 호스트가 아닌 연결만 허용.
// 운영 앵커는 오직 운영 런타임의 POST /api/admin/credential-key로 만든다.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { setAnchorTargetRefusal, PRODUCTION_DB_ENDPOINTS } = require('../anchor-target.ts');

const ROOT = path.resolve(__dirname, '../../..');
const PROD = (pooler) => `postgresql://u:p@${PRODUCTION_DB_ENDPOINTS[0]}${pooler ? '-pooler' : ''}.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require`;
const LOCAL = 'postgresql://u:p@127.0.0.1:5432/scratch';
const FLAG = ['--kid=0123456789abcdef', '--non-production'];

test('refuses without the explicit --non-production flag even for a non-production DB', () => {
  assert.equal(setAnchorTargetRefusal(['--kid=0123456789abcdef'], { DATABASE_URL: LOCAL }), 'flag_missing');
  assert.equal(setAnchorTargetRefusal(['--kid=0123456789abcdef', '--non-production=1'], { DATABASE_URL: LOCAL }), 'flag_missing');
});

test('refuses any production DB endpoint (pooled or direct, in any Prisma url env) and any production runtime', () => {
  for (const name of ['DATABASE_URL', 'DIRECT_URL', 'POSTGRES_PRISMA_URL', 'POSTGRES_URL', 'DATABASE_URL_UNPOOLED', 'POSTGRES_URL_NON_POOLING']) {
    for (const pooler of [true, false]) {
      assert.equal(setAnchorTargetRefusal(FLAG, { DATABASE_URL: LOCAL, [name]: PROD(pooler) }), 'production_db', `${name} pooler=${pooler}`);
    }
  }
  assert.equal(setAnchorTargetRefusal(FLAG, { DATABASE_URL: PROD(true).replace('ep-', 'EP-') }), 'production_db', '호스트 대소문자 무시');
  assert.equal(setAnchorTargetRefusal(FLAG, { DATABASE_URL: LOCAL, VERCEL_ENV: 'production' }), 'production_runtime');
});

test('refuses when no DB url is set or a url cannot be parsed; allows a flagged non-production DB', () => {
  assert.equal(setAnchorTargetRefusal(FLAG, {}), 'db_url_missing');
  assert.equal(setAnchorTargetRefusal(FLAG, { DATABASE_URL: '  ' }), 'db_url_missing');
  assert.equal(setAnchorTargetRefusal(FLAG, { DATABASE_URL: 'not a url' }), 'db_url_unparsable');
  assert.equal(setAnchorTargetRefusal(FLAG, { DATABASE_URL: LOCAL, DIRECT_URL: LOCAL }), null);
});

// 스크립트 배선: 거부되면 Prisma를 import하기 전에 끝난다(실 DB 연결 0). prisma 모듈은 함정으로 바꿔 기록만 한다.
const runScript = (args, env) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'set-anchor-')); // .env.local 없는 빈 cwd
  const marker = path.join(cwd, 'prisma-touched');
  const pre = path.join(cwd, 'pre.cjs');
  fs.writeFileSync(pre, `require(${JSON.stringify(path.join(ROOT, 'lib/visibility/__tests__/register.cjs'))});
require.cache[${JSON.stringify(path.join(ROOT, 'lib/prisma.ts'))}] = { exports: { prisma: new Proxy({}, { get: (_t, k) => {
  require('node:fs').appendFileSync(${JSON.stringify(marker)}, String(k) + '\\n');
  if (k === '$disconnect') return async () => {};
  return async () => { throw new Error('trap'); };
} }) } };`);
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(DATABASE_URL|DIRECT_URL|POSTGRES_|VERCEL_ENV|CREDENTIAL_)/.test(k)));
  const r = spawnSync(process.execPath, ['-r', pre, '-e', `require(${JSON.stringify(path.join(ROOT, 'scripts/crypto/set-anchor.ts'))})`, '--', ...args], { cwd, env: { ...clean, ...env }, encoding: 'utf8' });
  const touched = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : '';
  fs.rmSync(cwd, { recursive: true, force: true });
  return { code: r.status, stderr: r.stderr, stdout: r.stdout, touched };
};

test('set-anchor script refuses production before importing Prisma, and only reaches Prisma when the guard passes', () => {
  let r = runScript(['--kid=0123456789abcdef'], { DATABASE_URL: PROD(true) });
  assert.deepEqual([r.code, r.stderr.trim(), r.touched], [1, '거부: flag_missing — 운영 앵커는 운영 화면의 POST /api/admin/credential-key로만 만든다', '']);
  r = runScript(FLAG, { DATABASE_URL: PROD(true) });
  assert.deepEqual([r.code, r.stderr.trim().split(' ')[1], r.touched], [1, 'production_db', '']);
  r = runScript(FLAG, { DATABASE_URL: LOCAL });
  assert.notEqual(r.touched, '', '가드를 통과하면 그때 Prisma에 닿는다(여기선 함정)');
  assert.equal(r.code, 1);
});

test('set-anchor header states that production anchors come only from the production POST', () => {
  const header = fs.readFileSync(path.join(ROOT, 'scripts/crypto/set-anchor.ts'), 'utf8').split('\nimport ')[0];
  assert.match(header, /운영 앵커는[^\n]*POST \/api\/admin\/credential-key[^\n]*로만/);
  assert.match(header, /--non-production/);
});
