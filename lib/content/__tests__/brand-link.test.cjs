/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require */
// 2026-11-06 운영 자동 생성 글: 모델이 자사 주소 대신 "(자사 링크로 연결)" 자리표시를 써서 링크가 빠짐.
require('../../visibility/__tests__/register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {ensureBrandLink,brandSiteUrl}=require('../brand-link.ts');
const bg={website_url:'https://vestra.ai.kr',cta_message:'보이지 않는 위험까지 AI가 먼저 감지합니다. 로그인 없이 기본 분석을 시작하세요.'};
const tail='## VESTRA와 함께 안전한 전세 계약\n\n**보이지 않는 위험까지 AI가 먼저 감지합니다. 로그인 없이 기본 분석을 시작하세요. (자사 링크로 연결)**\n\n---\n\n**태그:** #전세사기예방 #VESTRA';
test('the placeholder the model wrote is replaced by the real site address (운영 글 재현)',()=>{
 const out=ensureBrandLink('본문\n\n'+tail,bg,'blog');
 assert.ok(!out.includes('자사 링크로 연결'));
 assert.equal(out.match(/https:\/\/vestra\.ai\.kr/g).length,1);
 assert.ok(out.indexOf('https://vestra.ai.kr')<out.indexOf('**태그:**'),'link stays in the CTA section, before the tags');
});
test('a missing link is added once under the CTA message; an existing link is left alone',()=>{
 const noLink='본문\n\n## 마무리\n\n보이지 않는 위험까지 AI가 먼저 감지합니다. 로그인 없이 기본 분석을 시작하세요.\n\n**태그:** #a';
 const out=ensureBrandLink(noLink,bg,'blog');
 assert.equal(out.match(/vestra\.ai\.kr/g).length,1);
 assert.ok(out.indexOf('vestra.ai.kr')>out.indexOf('기본 분석을 시작하세요.')&&out.indexOf('vestra.ai.kr')<out.indexOf('**태그:**'));
 const has='본문\n\n자세한 내용은 https://vestra.ai.kr/jeonse 에서 확인하세요.';
 assert.equal(ensureBrandLink(has,bg,'blog'),has);
 assert.equal(ensureBrandLink(ensureBrandLink(noLink,bg,'blog'),bg,'blog'),out,'idempotent');
 assert.ok(ensureBrandLink('본문만 있음',bg,'blog').endsWith('https://vestra.ai.kr'));
});
test('only blog posts with a valid http(s) site get a link; cafe/SNS and bad settings are untouched',()=>{
 const t='본문 (자사 링크로 연결)';
 assert.equal(ensureBrandLink(t,bg,'naver_cafe'),t);
 assert.equal(ensureBrandLink(t,bg,'instagram'),t);
 assert.equal(ensureBrandLink(t,{},'blog'),'본문');
 for(const bad of ['javascript:alert(1)','vestra.ai.kr','ftp://x.kr','https://',' ',42])assert.equal(brandSiteUrl({website_url:bad}),null,String(bad));
 assert.equal(brandSiteUrl({website_url:' https://vestra.ai.kr/ '}),'https://vestra.ai.kr');
});
test('codex 반례: explanations survive, look-alike domains do not count, case/www are the same site, CTA uses the last occurrence',()=>{
 assert.equal(ensureBrandLink('설정 (사이트맵 제출 필요)을 확인하세요.',bg,'blog'),'설정 (사이트맵 제출 필요)을 확인하세요.\n\nhttps://vestra.ai.kr');
 assert.ok(ensureBrandLink('정책 (공식 홈페이지 참고)을 준수하세요.',bg,'blog').includes('(공식 홈페이지 참고)'));
 for(const p of ['(링크)','[자사 링크]','(홈페이지 바로가기)','(사이트 주소 삽입)','(URL)'])assert.equal(ensureBrandLink('끝 '+p,{},'blog'),'끝',p);
 assert.ok(ensureBrandLink('참고: https://vestra.ai.kr.evil.example/login',bg,'blog').endsWith('\n\nhttps://vestra.ai.kr'));
 assert.ok(ensureBrandLink('https://evil.example/?next=vestra.ai.kr',bg,'blog').endsWith('\n\nhttps://vestra.ai.kr'));
 for(const t of ['자세히: https://VESTRA.AI.KR','자세히: https://www.vestra.ai.kr/x'])assert.equal(ensureBrandLink(t,bg,'blog'),t);
 const two='서두에서 “지금 시작하세요.”라는 표현을 설명합니다.\n\n본문\n\n## CTA\n지금 시작하세요.';
 assert.ok(ensureBrandLink(two,{...bg,cta_message:'지금 시작하세요.'},'blog').endsWith('## CTA\n지금 시작하세요.\n\nhttps://vestra.ai.kr'));
 assert.equal(brandSiteUrl({website_url:'https://vestra.ai.kr/#/pricing'}),'https://vestra.ai.kr/#/pricing');
 assert.equal(brandSiteUrl({website_url:'https://shop.example/?coupon=**SAVE**'}),null,'publisher would strip ** as bold');
});
test('codex 2차 반례: bold/trailing-dot links count as present, markdown link labels stay, a CTA echoed in tags is ignored',()=>{
 for(const t of ['**https://vestra.ai.kr**','안내: https://vestra.ai.kr.'])assert.equal(ensureBrandLink(t,bg,'blog'),t);
 const md='참고: [공식 사이트 링크](https://vestra.ai.kr/guide)';
 assert.equal(ensureBrandLink(md,bg,'blog'),md);
 const tagged='지금 시작하세요.\n\n**태그:** #지금 시작하세요. #안내';
 assert.equal(ensureBrandLink(tagged,{...bg,cta_message:'지금 시작하세요.'},'blog'),'지금 시작하세요.\n\nhttps://vestra.ai.kr\n\n**태그:** #지금 시작하세요. #안내');
});
