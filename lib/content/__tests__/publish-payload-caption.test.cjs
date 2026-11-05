/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require */
// 미리보기 캡션 변환 = 실제 발행기 변환 (lib/publish/instagram·facebook 의 실제 함수와 비교).
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
require.cache[require.resolve('../../channel-credentials.ts')] = { exports: {
  getInstagramCreds: async () => null, getFacebookCreds: async () => null } };
const { buildInstagramCaption } = require('../../publish/instagram.ts');
const { buildFacebookMessage } = require('../../publish/facebook.ts');
const { previewInstagramCaption, previewFacebookMessage, buildPublishPreview } = require('../publish-payload.ts');

const SAMPLES = [
  '# 제목\n\n[이미지: 표지]\n\n**강조** 문단\n> 인용\n- 항목1\n- 항목2\n\n\n\n#해시 #태그',
  '',
  '평문만',
  'x'.repeat(3000),
  ('## 소제목\n' + '가'.repeat(100) + '\n').repeat(40),
];

for (const [i, md] of SAMPLES.entries()) {
  test(`캡션 동등성 #${i}`, () => {
    assert.equal(previewInstagramCaption(md), buildInstagramCaption(md));
    assert.equal(previewFacebookMessage(md), buildFacebookMessage(md));
  });
}

test('buildPublishPreview instagram 캐러셀: 캡션 변환 + 카드 전부', () => {
  const p = buildPublishPreview('instagram', { topic: 't', textBody: '**굵게**\n[이미지: a]', imageUrl: null, bodyImageUrls: ['u1', 'u2'] });
  assert.deepEqual(p, { channel: 'instagram', mode: 'carousel', text: '굵게', images: ['u1', 'u2'], blocked_reason: null });
});
