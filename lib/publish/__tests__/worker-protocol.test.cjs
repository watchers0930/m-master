/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, Request, process */
/* eslint-disable @typescript-eslint/no-unused-vars -- 구조 분해로 헤더 하나를 뺀다 */
// 블로그 작업자 서버 측 claim-v1 계약 (DB 없이 prisma·service 대역 사용)
// DB 실검증은 lib/pipeline/__tests__/backend.database.test.cjs(PGLITE_SOCKET_PACKAGE 필요)에서 수행.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { VisibilityError } = require('../../visibility/errors.ts');

process.env.BLOG_PUBLISH_OWNER_IDS = 'owner';
process.env.BLOG_PUBLISH_API_KEY = 'k'.repeat(40);
const TOKEN = 'a'.repeat(43);
const claims = [];
const reset = (status = 'claimed') => {
  claims.length = 0;
  claims.push({ id: 'cl1', ownerId: 'owner', token: TOKEN, targetType: 'content', targetId: 'c1', channel: 'blog', trigger: 'worker',
    status, leaseUntil: new Date(Date.now() + 600000), errorCode: null });
};
const match = (row, where) => Object.entries(where).every(([k, v]) =>
  v && typeof v === 'object' && !(v instanceof Date) ? ('in' in v ? v.in.includes(row[k]) : true) : row[k] === v);
let recorded = 0;
require.cache[require.resolve('../../prisma.ts')] = { exports: { prisma: { publishClaim: {
  findFirst: async ({ where }) => claims.find(r => match(r, where)) ?? null,
  updateMany: async ({ where, data }) => {
    const rows = claims.filter(r => match(r, where));
    rows.forEach(r => Object.assign(r, data));
    return { count: rows.length };
  },
} } } };
require.cache[require.resolve('../../cron/auth.ts')] = { exports: { getTodayKST: () => '2026-11-04' } };
require.cache[require.resolve('../claims.ts')] = { exports: {
  expireClaims: async () => {}, loadTarget: async () => { throw new Error('unused'); },
  publishError: reason => { throw new VisibilityError(reason, '발행 조건을 확인하세요.', 409); },
} };
require.cache[require.resolve('../service.ts')] = { exports: {
  revalidateClaim: async () => {},
  recordSent: async id => { const c = claims.find(r => r.id === id); if (c.status !== 'claimed') throw new VisibilityError('claim_invalid', 'x', 409); recorded++; c.status = 'sent'; },
} };
require.cache[require.resolve('../derive.ts')] = { exports: { deriveCafeContent: async () => ({ status: 'skipped', childContentId: null, reason: 'no_credentials' }) } };

const { completeWorkerClaim, failWorkerClaim, pendingBlogContent } = require('../worker.ts');
const { workerFailSchema, workerCompleteSchema } = require('../../../schemas/blog-worker.ts');
const { requireWorker } = require('../worker-auth.ts');
const URL_OK = 'https://blog.naver.com/vestra/224000000001';

test('위조 complete 거부: 모르는 토큰·다른 콘텐츠에 묶인 토큰 모두 claim_invalid, 기록 없음', async () => {
  reset(); recorded = 0;
  await assert.rejects(completeWorkerClaim('owner', 'c1', 'b'.repeat(43), URL_OK), e => e.code === 'claim_invalid' && e.status === 409);
  await assert.rejects(completeWorkerClaim('owner', 'other', TOKEN, URL_OK), e => e.code === 'claim_invalid');
  assert.equal(recorded, 0);
  assert.equal(claims[0].status, 'claimed');
});

test('complete 재전송은 멱등: 두 번째 호출은 기록을 반복하지 않고 200', async () => {
  reset(); recorded = 0;
  assert.equal((await completeWorkerClaim('owner', 'c1', TOKEN, URL_OK)).ok, true);
  assert.equal((await completeWorkerClaim('owner', 'c1', TOKEN, URL_OK)).ok, true);
  assert.equal(recorded, 1);
  assert.equal(claims[0].status, 'sent');
});

test('fail(not_posted) 후 같은 토큰의 complete는 거부(반납된 claim으로 기록 불가)', async () => {
  reset(); recorded = 0;
  await failWorkerClaim('owner', 'c1', TOKEN, 'not_posted', 'session_expired');
  assert.equal(claims[0].status, 'released');
  assert.equal(claims[0].errorCode, 'not_posted:session_expired');
  await assert.rejects(completeWorkerClaim('owner', 'c1', TOKEN, URL_OK), e => e.code === 'claim_invalid');
  assert.equal(recorded, 0);
  assert.deepEqual(await failWorkerClaim('owner', 'c1', TOKEN, 'not_posted', 'session_expired'), { ok: true }); // 재전송 멱등
});

test('이미 sent인 claim에 fail은 거부, 위조 토큰 fail도 거부', async () => {
  reset('sent');
  await assert.rejects(failWorkerClaim('owner', 'c1', TOKEN, 'not_posted', 'timeout'), e => e.code === 'claim_invalid');
  assert.equal(claims[0].status, 'sent');
  await assert.rejects(failWorkerClaim('owner', 'c1', 'z'.repeat(43), 'unknown', 'timeout'), e => e.code === 'claim_invalid');
});

test('fail 스키마는 사유 코드만 허용(자유 문장·HTML·쿠키 문자열 거부), complete URL은 네이버 블로그만', () => {
  const base = { contentId: 'c1', claimToken: TOKEN, outcome: 'not_posted' };
  assert.equal(workerFailSchema.safeParse({ ...base, error: 'captcha_required' }).success, true);
  for (const error of ['<html>로그인</html>', 'NID_AUT=abc; NID_SES=def', 'Session Expired', '', 'x'.repeat(65)])
    assert.equal(workerFailSchema.safeParse({ ...base, error }).success, false, error);
  assert.equal(workerCompleteSchema.safeParse({ contentId: 'c1', claimToken: TOKEN, externalUrl: URL_OK }).success, true);
  assert.equal(workerCompleteSchema.safeParse({ contentId: 'c1', claimToken: TOKEN, externalUrl: 'https://evil.example/blog.naver.com' }).success, false);
});

test('작업자 인증: 키 불일치 401, 프로토콜 헤더 없으면 409, 소유자 헤더 없음 400·허용 목록 밖 403(4개 라우트 공용)', () => {
  const req = headers => new Request('https://app.test/api/blog-publish/complete', { method: 'POST', headers });
  const ok = { 'x-api-key': 'k'.repeat(40), 'x-blog-worker-protocol': 'claim-v1', 'x-blog-worker-owner': 'owner' };
  assert.throws(() => requireWorker(req({ ...ok, 'x-api-key': 'wrong' })), e => e.status === 401);
  assert.throws(() => requireWorker(req({ 'x-api-key': 'k'.repeat(40) })), e => e.status === 409 && e.code === 'worker_upgrade_required');
  const { 'x-blog-worker-owner': _omit, ...noOwner } = ok;
  assert.throws(() => requireWorker(req(noOwner)), e => e.status === 400 && e.code === 'worker_owner_required');
  assert.throws(() => requireWorker(req({ ...ok, 'x-blog-worker-owner': 'intruder' })), e => e.status === 403 && e.code === 'owner_not_allowed');
  assert.deepEqual(requireWorker(req(ok)), { ownerId: 'owner' });
});

test('비상 정지 스위치: pending·verify(automation)는 503 fail-closed, complete·fail은 정지 중에도 기록 허용', () => {
  const req = () => new Request('https://app.test/api/blog-publish/pending', { headers: {
    'x-api-key': 'k'.repeat(40), 'x-blog-worker-protocol': 'claim-v1', 'x-blog-worker-owner': 'owner' } });
  const saved = process.env.PIPELINE_AUTOMATION_ENABLED;
  try {
    for (const value of [undefined, '', 'false', 'TRUE', '1']) {
      if (value === undefined) delete process.env.PIPELINE_AUTOMATION_ENABLED; else process.env.PIPELINE_AUTOMATION_ENABLED = value;
      assert.throws(() => requireWorker(req(), { automation: true }), e => e.status === 503 && e.code === 'automation_paused', String(value));
      assert.deepEqual(requireWorker(req()), { ownerId: 'owner' });
    }
    process.env.PIPELINE_AUTOMATION_ENABLED = 'true';
    assert.deepEqual(requireWorker(req(), { automation: true }), { ownerId: 'owner' });
  } finally {
    if (saved === undefined) delete process.env.PIPELINE_AUTOMATION_ENABLED; else process.env.PIPELINE_AUTOMATION_ENABLED = saved;
  }
});

test('다른 소유자(허용 목록 안이라도)의 claim 토큰으로는 complete·fail 불가', async () => {
  reset(); recorded = 0;
  await assert.rejects(completeWorkerClaim('owner2', 'c1', TOKEN, URL_OK), e => e.code === 'claim_invalid');
  await assert.rejects(failWorkerClaim('owner2', 'c1', TOKEN, 'not_posted', 'timeout'), e => e.code === 'claim_invalid');
  assert.equal(recorded, 0);
  assert.equal(claims[0].status, 'claimed');
});

test('pending은 지정된 소유자 한 명만 조회한다(다른 소유자 사용자 행 잠금·조회 없음)', async () => {
  const touched = [];
  const tx = {
    $queryRaw: async (strings, ...values) => { touched.push(...values.filter(v => typeof v === 'string' && v.startsWith('owner'))); return []; },
    publishClaim: { findFirst: async ({ where }) => { touched.push(where.ownerId); return null; } },
    content: { findFirst: async () => null },
  };
  const prismaMock = require.cache[require.resolve('../../prisma.ts')].exports.prisma;
  prismaMock.$transaction = async fn => fn(tx);
  process.env.BLOG_PUBLISH_OWNER_IDS = 'owner,owner2';
  try {
    const result = await pendingBlogContent('owner');
    assert.equal(result.reason, 'no_eligible_content');
    assert.ok(touched.length > 0 && touched.every(o => o === 'owner'), JSON.stringify(touched));
  } finally { process.env.BLOG_PUBLISH_OWNER_IDS = 'owner'; delete prismaMock.$transaction; }
});
