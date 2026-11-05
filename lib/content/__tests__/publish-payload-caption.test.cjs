/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require */
// 미리보기 캡션 변환 = 실제 발행기 변환 — 단일 구현(lib/publish/payload.ts)을 어댑터·미리보기가 공유하는지 강제.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
require.cache[require.resolve('../../channel-credentials.ts')] = { exports: {
  getInstagramCreds: async () => null, getFacebookCreds: async () => null } };
const { buildInstagramCaption } = require('../../publish/instagram.ts');
const { buildFacebookMessage } = require('../../publish/facebook.ts');
const preview = require('../publish-payload.ts');
const { buildPublishPreview } = preview;
const pure = require('../../publish/payload.ts');

const SAMPLES = [
  '# 제목\n\n[이미지: 표지]\n\n**강조** 문단\n> 인용\n- 항목1\n- 항목2\n\n\n\n#해시 #태그',
  '',
  '평문만',
  'x'.repeat(3000),
  ('## 소제목\n' + '가'.repeat(100) + '\n').repeat(40),
];

test('캡션 변환은 단일 구현 — 어댑터·미리보기가 같은 함수', () => {
  assert.equal(buildInstagramCaption, pure.buildInstagramCaption);
  assert.equal(buildFacebookMessage, pure.buildFacebookMessage);
  assert.equal(preview.buildInstagramCaption, pure.buildInstagramCaption);
  assert.equal(preview.buildFacebookMessage, pure.buildFacebookMessage);
});
for (const [i, md] of SAMPLES.entries()) {
  test(`IG 캡션 2200자 상한 #${i}`, () => {
    assert.ok(buildInstagramCaption(md).length <= 2200);
    assert.ok(!buildFacebookMessage(md).includes('[이미지:'));
  });
}

test('buildPublishPreview instagram 캐러셀: 캡션 변환 + 카드 전부', () => {
  const p = buildPublishPreview('instagram', { topic: 't', textBody: '**굵게**\n[이미지: a]', imageUrl: null, bodyImageUrls: ['u1', 'u2'] });
  assert.deepEqual(p, { channel: 'instagram', mode: 'carousel', text: '굵게', images: ['u1', 'u2'], blocked_reason: null });
});
