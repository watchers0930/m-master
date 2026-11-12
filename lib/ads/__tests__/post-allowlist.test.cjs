/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, __dirname */
// 네이버 POST 허용 경로(B4 판정 2) — 소스 검사. 네이버 클라이언트로 POST를 보내는 곳은 둘뿐이다:
// - lib/ads/oplog.ts sendMutation(쓰기 — execution.ts 스위치·원장을 거친다)
// - lib/ads/estimate.ts(읽기 전용 입찰 추정 — ESTIMATE_PATHS 상수 경로만, 스위치·원장 없음)
// 그 밖의 광고 코드(lib/ads·app/api/ads·네이버 클라이언트를 import하는 모든 파일)에 .post( · ["post"]( 가 새로 생기면 실패한다.
// 네이버 호스트 문자열(직접 fetch)은 lib/external/naver-searchad.ts 밖 lib/·app/ 어디에도 없어야 한다. PUT은 이 검사 범위 밖(B4 판정).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../../..');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p, out); }
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
// .post( · ?.post( · ["post"]( · ['post']( · [`post`]( (대괄호 접근 우회 포함)
const POST_CALL = /(?:\.\s*post|\[\s*["'`]post["'`]\s*\])\s*(?:<[^>]*>)?\s*\(/;
// 네이버 API 호스트 — 이 문자열(=직접 fetch 대상)은 클라이언트 파일 한 곳에만 있어야 한다
const NAVER_HOST = /api\.searchad\.naver\.com/i;

function adsFiles() {
  const files = new Set([...walk(path.join(ROOT, 'lib/ads')), ...walk(path.join(ROOT, 'app/api/ads'))]);
  for (const f of [...walk(path.join(ROOT, 'lib')), ...walk(path.join(ROOT, 'app'))])
    if (/from\s+["']@\/lib\/external\/naver-searchad["']/.test(fs.readFileSync(f, 'utf8'))) files.add(f);
  return [...files];
}

test('only oplog.ts (writes) and estimate.ts (read-only estimate) call .post on a Naver client', () => {
  const callers = adsFiles().filter((f) => POST_CALL.test(fs.readFileSync(f, 'utf8'))).map(rel).sort();
  assert.deepEqual(callers, ['lib/ads/estimate.ts', 'lib/ads/oplog.ts']);
});

test('estimate.ts posts only to a constant from ESTIMATE_PATHS and never touches the write path', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/ads/estimate.ts'), 'utf8');
  const args = [...src.matchAll(/\.post\s*(?:<[^>]*>)?\s*\(\s*([^,\s)]+)/g)].map((m) => m[1]);
  assert.ok(args.length > 0);
  for (const a of args) assert.equal(a, 'POSITION_BID_PATH', `post 경로는 허용목록 상수만: ${a}`);
  assert.match(src, /const POSITION_BID_PATH = ESTIMATE_PATHS\[0\]/);
  for (const f of ['lib/ads/estimate.ts', 'lib/ads/proposal-estimate.ts', 'app/api/ads/proposals/[id]/estimate/route.ts']) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(s, /["']\.\/(?:execution|oplog|apply)["']|@\/lib\/ads\/(?:execution|oplog|apply)["']|ADS_EXECUTION_ENABLED|isExecutionEnabled|assertExecutionEnabled/, f);
  }
});

test('no direct fetch to the Naver API host outside lib/external/naver-searchad.ts (all of lib/ and app/)', () => {
  const files = [...walk(path.join(ROOT, 'lib')), ...walk(path.join(ROOT, 'app'))];
  const hits = files.filter((f) => NAVER_HOST.test(fs.readFileSync(f, 'utf8'))).map(rel).sort();
  assert.deepEqual(hits, ['lib/external/naver-searchad.ts']);
  assert.match(fs.readFileSync(path.join(ROOT, 'lib/external/naver-searchad.ts'), 'utf8'), /const BASE_URL = "https:\/\/api\.searchad\.naver\.com";/);
});

test('the detectors themselves see post calls and host literals in the usual forms', () => {
  for (const s of ['client.post("/x", b)', 'c.post<T>(p, b)', 'inner . post (p)', 'c?.post(p)', 'c["post"]("/ncc/x", {})', "c['post'](p, b)", 'c[`post`](p)', 'c[ "post" ] <T>(p)'])
    assert.ok(POST_CALL.test(s), s);
  for (const s of ['post: () => reject()', 'const post = 1', 'x["poster"](1)', 'POST']) assert.equal(POST_CALL.test(s), false, s);
  for (const s of ['fetch("https://api.searchad.naver.com/ncc/campaigns")', "`https://API.SEARCHAD.NAVER.COM${p}`"]) assert.ok(NAVER_HOST.test(s), s);
});
