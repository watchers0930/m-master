require('../../visibility/__tests__/register.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildNaverCafeContent}=require('../naver-cafe.ts');
test('카페 HTML: 인용문·이미지 속성 주입 차단',()=>{
  const html=buildNaverCafeContent('> <script>alert(1)</script>\n[이미지: a]\n[이미지: b]\n일반 <b>x</b>',['https://e.com/a.png" onerror="x','javascript:alert(1)']);
  assert.ok(!html.includes('<script>'),html);
  assert.ok(html.includes('&lt;script&gt;'),html);
  assert.ok(!html.includes('onerror="x'),html);
  assert.ok(!html.includes('javascript:'),html);
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'),html);
});
