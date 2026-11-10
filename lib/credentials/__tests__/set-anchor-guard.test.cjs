/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process, __dirname */
// scripts/crypto/set-anchor.ts는 운영 DB에 쓰지 못한다: --non-production 플래그 + 허용목록(로컬·SET_ANCHOR_ALLOWED_HOSTS) 연결만 허용.
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

// 재검토 N3: 거부목록이 아니라 허용목록 — 로컬(localhost·127.0.0.1·::1·유닉스 소켓) 또는 SET_ANCHOR_ALLOWED_HOSTS에 적힌 호스트·엔드포인트만.
test('allowlist: unknown hosts and pooler/direct aliases of an unlisted endpoint are refused; local and listed endpoints are allowed', () => {
  const OTHER = (pooler) => `postgresql://u:p@ep-fragrant-sunset-ank6puka${pooler ? '-pooler' : ''}.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require`;
  const refusal = (url, extra = {}) => setAnchorTargetRefusal(FLAG, { DATABASE_URL: url, ...extra });
  for (const url of [OTHER(true), OTHER(false), 'postgresql://u:p@db.example.com:5432/x', 'postgresql://u:p@10.0.0.5/x', 'postgresql://u:p@localhost.evil.example/x'])
    assert.equal(refusal(url), 'db_host_not_allowed', url);
  assert.equal(refusal(PROD(true)), 'production_db', '운영 풀러');
  assert.equal(refusal(PROD(false)), 'production_db', '운영 직접');
  for (const url of [LOCAL, 'postgresql://u:p@localhost:5432/x', 'postgresql://u:p@LOCALHOST/x', 'postgresql://u:p@[::1]:5432/x', 'postgresql://u@localhost/x?host=/tmp/.s.PGSQL.5432'])
    assert.equal(refusal(url), null, url);
  assert.equal(setAnchorTargetRefusal(FLAG, { DATABASE_URL: LOCAL, DIRECT_URL: OTHER(false) }), 'db_host_not_allowed', '로컬 + 목록 밖 하나 = 거부');
  // 명시 허용: 엔드포인트 id(풀러·직접 둘 다) 또는 호스트 전체 이름, 대소문자·공백 무시
  const listed = { SET_ANCHOR_ALLOWED_HOSTS: ' EP-FRAGRANT-SUNSET-ANK6PUKA , db.example.com' };
  assert.deepEqual([refusal(OTHER(true), listed), refusal(OTHER(false), listed), refusal('postgresql://u:p@db.example.com/x', listed)], [null, null, null]);
  assert.equal(refusal('postgresql://u:p@db2.example.com/x', listed), 'db_host_not_allowed');
  assert.equal(refusal(PROD(true), { SET_ANCHOR_ALLOWED_HOSTS: PRODUCTION_DB_ENDPOINTS[0] }), 'production_db', '운영은 허용목록에 적어도 거부');
});

test('allowlist judges the host actually dialed: ?host=/?hostaddr= overrides and Neon options=endpoint are checked', () => {
  const refusal = (url, extra = {}) => setAnchorTargetRefusal(FLAG, { DATABASE_URL: url, ...extra });
  assert.equal(refusal(`postgresql://u:p@localhost/x?host=${PRODUCTION_DB_ENDPOINTS[0]}-pooler.c-7.us-east-1.aws.neon.tech`), 'production_db');
  assert.equal(refusal('postgresql://u:p@localhost/x?hostaddr=10.0.0.5'), 'db_host_not_allowed');
  // 재검토 I-2: Prisma 6.19는 hostaddr를 무시하고 url 호스트로 붙는다 → url 호스트·host·hostaddr 모두를 후보로 보고 하나라도 운영·목록 밖이면 거부
  const prodPooler = `${PRODUCTION_DB_ENDPOINTS[0]}-pooler.c-7.us-east-1.aws.neon.tech`;
  assert.equal(refusal(`postgresql://u:p@${prodPooler}/neondb?sslmode=require&hostaddr=127.0.0.1`), 'production_db', '운영 url + hostaddr=로컬');
  assert.equal(refusal(`postgresql://u:p@bogus/neondb?host=${prodPooler}&hostaddr=127.0.0.1`), 'production_db', 'host=운영 + hostaddr=로컬');
  assert.equal(refusal('postgresql://u:p@db.example.com/x?hostaddr=127.0.0.1'), 'db_host_not_allowed', '목록 밖 url 호스트 + hostaddr=로컬');
  assert.equal(refusal('postgresql://u:p@localhost/x?host=/tmp&hostaddr=127.0.0.1'), null, '모든 후보가 로컬');
  // 재검토 I-4: Prisma 6.19는 같은 쿼리 키가 여럿이면 마지막 값으로 붙는다 → 모든 값(getAll)과 쉼표 여러 호스트를 후보로
  assert.equal(refusal(`postgresql://u:p@localhost/x?host=localhost&host=${prodPooler}`), 'production_db', 'host 중복(마지막 = 운영)');
  assert.equal(refusal(`postgresql://u:p@localhost/x?hostaddr=127.0.0.1&hostaddr=${prodPooler}`), 'production_db', 'hostaddr 중복');
  assert.equal(refusal('postgresql://u:p@localhost/x?hostaddr=127.0.0.1&hostaddr=10.0.0.5'), 'db_host_not_allowed', 'hostaddr 중복(목록 밖)');
  assert.equal(refusal(`postgresql://u:p@localhost/x?options=-c%20search_path%3Dpublic&options=endpoint%3D${PRODUCTION_DB_ENDPOINTS[0]}`), 'production_db', 'options 두 번(두 번째 = 운영)');
  assert.equal(refusal(`postgresql://u:p@localhost/x?options=endpoint%3Dep-ok-1%20endpoint%3D${PRODUCTION_DB_ENDPOINTS[0]}`, { SET_ANCHOR_ALLOWED_HOSTS: 'ep-ok-1' }), 'production_db', '한 options 안 endpoint 여럿');
  assert.equal(refusal(`postgresql://u:p@localhost/x?host=localhost,${prodPooler}`), 'production_db', '쉼표 여러 호스트(host=)');
  assert.equal(refusal(`postgresql://u:p@localhost,${prodPooler}/x`), 'production_db', '쉼표 여러 호스트(url 호스트)');
  assert.equal(refusal(`postgresql://u:p@localhost/x?options=endpoint%3D${PRODUCTION_DB_ENDPOINTS[0]}`), 'production_db');
  assert.equal(refusal('postgresql://u:p@localhost/x?options=endpoint%3Dep-other-1'), 'db_host_not_allowed');
  assert.equal(refusal('postgresql://u:p@localhost/x?options=endpoint%3Dep-other-1', { SET_ANCHOR_ALLOWED_HOSTS: 'ep-other-1' }), null);
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
  r = runScript(FLAG, { DATABASE_URL: 'postgresql://u:p@db.example.com/x' });
  assert.deepEqual([r.code, r.stderr.trim().split(' ')[1], r.touched], [1, 'db_host_not_allowed', ''], '처음 보는 호스트도 Prisma 전에 거부');
  r = runScript(FLAG, { DATABASE_URL: LOCAL });
  assert.notEqual(r.touched, '', '가드를 통과하면 그때 Prisma에 닿는다(여기선 함정)');
  assert.equal(r.code, 1);
});

test('set-anchor header states that production anchors come only from the production POST', () => {
  const header = fs.readFileSync(path.join(ROOT, 'scripts/crypto/set-anchor.ts'), 'utf8').split('\nimport ')[0];
  assert.match(header, /운영 앵커는[^\n]*POST \/api\/admin\/credential-key[^\n]*로만/);
  assert.match(header, /--non-production/);
});
