/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require */
require('../../visibility/__tests__/register.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const targets={t_same:{ownerId:'A',clubId:'111',menuId:'9'},t_other:{ownerId:'A',clubId:'111',menuId:'10'}};
require.cache[require.resolve('../../prisma.ts')]={exports:{prisma:{cafeTarget:{findFirst:async({where})=>{
  const t=targets[where.id];return t&&t.ownerId===where.ownerId?{clubId:t.clubId,menuId:t.menuId}:null;}}}}};
require.cache[require.resolve('../../channel-credentials.ts')]={exports:{getNaverCafeCreds:async owner=>owner==='A'?{clubId:'111',menuId:'9'}:null}};
const {VisibilityError}=require('../../visibility/errors.ts');
require.cache[require.resolve('../../visibility/http.ts')]={exports:{VisibilityError,notFound:()=>{throw new VisibilityError('not_found','x',404);}}};
require.cache[require.resolve('../../content/review.ts')]={exports:{lockContent:async()=>null}};
const {canonicalDestinationKey}=require('../claims.ts');
test('카페 기본 게시판과 같은 게시판의 등록 대상 = 같은 멱등 키(중복 게시 차단)',async()=>{
  assert.equal(await canonicalDestinationKey('A','naver_cafe','default'),'cafe:111:9');
  assert.equal(await canonicalDestinationKey('A','naver_cafe','t_same'),'cafe:111:9');
  assert.equal(await canonicalDestinationKey('A','naver_cafe','t_other'),'cafe:111:10');
});
test('타인 대상은 404, 카페 외 채널은 default',async()=>{
  await assert.rejects(()=>canonicalDestinationKey('B','naver_cafe','t_same'));
  assert.equal(await canonicalDestinationKey('A','facebook','anything'),'default');
  assert.equal(await canonicalDestinationKey('B','naver_cafe','default'),'default');
});
