/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process, __dirname */
// '광고' 메뉴 플래그(Task 12 fix round 1 판정): 세션 콜백이 서버에서 session.user.adsEnabled = isAdsOwner(id)를 정한다.
// 메뉴는 UX일 뿐 — API는 여전히 허용목록으로 404. env 없음·빈 값은 false(fail-closed).
// 그리고 (dashboard) layout은 auth()·headers()를 부르지 않는다(부르면 그룹 전체가 동적 렌더가 된다 — 회귀 방지 소스 검사).
require('../../visibility/__tests__/register.cjs');
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sessionCallback } = require('../../auth-session.ts');

const saved = process.env.ADS_OWNER_IDS;
afterEach(() => { if (saved === undefined) delete process.env.ADS_OWNER_IDS; else process.env.ADS_OWNER_IDS = saved; });
const run = (token) => sessionCallback({ session: { user: { name: 'n', email: 'e' }, expires: 'x' }, token });

test('session callback: allowlisted id → adsEnabled true, other ids false', () => {
  process.env.ADS_OWNER_IDS = 'owner-1, owner-2';
  const s = run({ id: 'owner-2', sub: 'owner-2' });
  assert.equal(s.user.id, 'owner-2');
  assert.equal(s.user.adsEnabled, true);
  assert.equal(run({ id: 'someone', sub: 'someone' }).user.adsEnabled, false);
  assert.equal(run({ sub: 'owner-1' }).user.adsEnabled, true, 'id가 없으면 sub(NextAuth 기본 사용자 id)');
  assert.equal(run({}).user.adsEnabled, false, 'id 없음 → false');
});

test('session callback: missing or empty env fails closed', () => {
  delete process.env.ADS_OWNER_IDS;
  assert.equal(run({ id: 'owner-1' }).user.adsEnabled, false);
  process.env.ADS_OWNER_IDS = ' , ';
  assert.equal(run({ id: 'owner-1' }).user.adsEnabled, false);
});

test('dashboard layout stays static: no auth() or headers()/cookies() call', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../../app/(dashboard)/layout.tsx'), 'utf8');
  for (const re of [/\bauth\s*\(/, /\bheaders\s*\(/, /\bcookies\s*\(/, /from\s+['"]@\/lib\/auth['"]/, /from\s+['"]next\/headers['"]/, /async\s+function\s+DashboardLayout/])
    assert.equal(re.test(src), false, `layout.tsx must not match ${re}`);
});
