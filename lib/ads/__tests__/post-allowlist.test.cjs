/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, __dirname */
// 네이버 POST 허용 경로(B4 판정 2) — 소스 검사. 네이버 클라이언트로 POST를 보내는 곳은 둘뿐이다:
// - lib/ads/oplog.ts sendMutation(쓰기 — execution.ts 스위치·원장을 거친다)
// - lib/ads/estimate.ts(읽기 전용 입찰 추정 — ESTIMATE_PATHS 상수 경로만, 스위치·원장 없음)
// 그 밖의 광고 코드(lib/ads·app/api/ads·네이버 클라이언트를 import하는 모든 파일)에 .post( 가 새로 생기면 실패한다.
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
const POST_CALL = /\.\s*post\s*(?:<[^>]*>)?\s*\(/;

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

test('the detector itself sees post calls in the usual forms', () => {
  for (const s of ['client.post("/x", b)', 'c.post<T>(p, b)', 'inner . post (p)']) assert.ok(POST_CALL.test(s), s);
  assert.equal(POST_CALL.test('post: () => reject()'), false);
});
