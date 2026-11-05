/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require */
// 미리보기 페이로드 = 실제 발행 페이로드 (교차검수: 인스타 카드 미리보기 누락 회귀 방지).
// lib/publish/channels.ts sendChannel 을 채널 발행 함수 대역으로 실행해, 그 인자와 planChannelPayload 결과를 비교한다.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const calls = [];
require.cache[require.resolve('../../prisma.ts')] = { exports: { prisma: {} } };
const { VisibilityError } = require('../../visibility/errors.ts');
require.cache[require.resolve('../../visibility/http.ts')] = { exports: { VisibilityError, notFound: () => { throw new VisibilityError('not_found', 'x', 404); } } };
require.cache[require.resolve('../../publish/facebook.ts')] = { exports: {
  publishFacebookPost: async (o) => { calls.push({ fn: 'facebook', ...o }); return { id: 'f1' }; },
  buildFacebookMessage: (s) => s } };
require.cache[require.resolve('../../publish/instagram.ts')] = { exports: {
  publishInstagramImage: async (o) => { calls.push({ fn: 'ig_single', ...o }); return { id: 'i1' }; },
  publishInstagramCarousel: async (o) => { calls.push({ fn: 'ig_carousel', ...o }); return { id: 'i2' }; },
  buildInstagramCaption: (s) => s } };
require.cache[require.resolve('../../publish/naver-cafe.ts')] = { exports: {
  publishNaverCafePost: async (o) => { calls.push({ fn: 'cafe', ...o }); return { articleId: 'a1', cafeUrl: 'u' }; } } };

const { sendChannel } = require('../../publish/channels.ts');
const { planChannelPayload, INSTAGRAM_IMAGE_REQUIRED } = require('../publish-payload.ts');

const base = { ownerId: 'o', topic: '제목', textBody: '본문\n[이미지: 표지]', keywords: ['k'] };
const CASES = [
  { name: '대표+카드 3장', imageUrl: 'https://x/hero.png', bodyImageUrls: ['https://x/1.png', '', 'https://x/2.png', 'https://x/3.png'] },
  { name: '카드만 2장(대표 없음)', imageUrl: null, bodyImageUrls: ['https://x/1.png', 'https://x/2.png'] },
  { name: '카드 1장', imageUrl: null, bodyImageUrls: ['https://x/1.png'] },
  { name: '대표만', imageUrl: 'https://x/hero.png', bodyImageUrls: [] },
  { name: '이미지 없음', imageUrl: null, bodyImageUrls: [] },
  { name: '본문 없음', imageUrl: null, bodyImageUrls: [], textBody: null },
];

async function actual(channel, row) {
  calls.length = 0;
  try { await sendChannel(channel, row, 'default'); } catch (e) { return { error: e.message }; }
  return calls[0];
}

for (const c of CASES) {
  test(`instagram 동등성: ${c.name}`, async () => {
    const row = { ...base, ...c };
    const plan = planChannelPayload('instagram', row);
    const got = await actual('instagram', row);
    if (plan.mode === 'blocked') return assert.deepEqual(got, { error: INSTAGRAM_IMAGE_REQUIRED });
    if (plan.mode === 'carousel') {
      assert.equal(got.fn, 'ig_carousel');
      assert.deepEqual(got.imageUrls, plan.images);
    } else {
      assert.equal(got.fn, 'ig_single');
      assert.deepEqual([got.imageUrl], plan.images);
    }
    assert.equal(got.caption, plan.text);
  });
  test(`facebook 동등성: ${c.name}`, async () => {
    const row = { ...base, ...c };
    const plan = planChannelPayload('facebook', row);
    const got = await actual('facebook', row);
    assert.deepEqual(got.imageUrl ? [got.imageUrl] : [], plan.images);
    assert.equal(plan.mode, got.imageUrl ? 'photo' : 'text');
    assert.equal(got.message, plan.text);
  });
  test(`naver_cafe 동등성(첨부 1장 규칙): ${c.name}`, async () => {
    const row = { ...base, ...c };
    const plan = planChannelPayload('naver_cafe', row);
    const got = await actual('naver_cafe', row);
    // publishNaverCafePost: imageUrls 우선, 없으면 imageUrl 폴백 → slice(0,1)
    let imgs = (got.imageUrls ?? []).filter(u => u && u.trim() !== '');
    if (imgs.length === 0 && got.imageUrl) imgs = [got.imageUrl];
    assert.deepEqual(imgs.slice(0, 1), plan.images);
    assert.equal(got.subject, plan.subject);
    assert.equal(got.content, plan.text);
  });
}

test('instagram 카드 3장 → 캐러셀, 빈 URL 제외', () => {
  const p = planChannelPayload('instagram', { ...base, ...CASES[0] });
  assert.equal(p.mode, 'carousel');
  assert.deepEqual(p.images, ['https://x/1.png', 'https://x/2.png', 'https://x/3.png']);
});
