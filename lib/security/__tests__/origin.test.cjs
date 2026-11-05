require('../../visibility/__tests__/register.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {isCrossSiteMutation,hasSameOriginProof}=require('../origin.ts');
const req=(method,headers={})=>new Request('https://m-master.vercel.app/api/x',{method,headers});
test('교차 사이트 변이 차단 — 다른 Origin·cross-site 헤더',()=>{
  assert.equal(isCrossSiteMutation(req('POST',{origin:'https://evil.example'})),true);
  assert.equal(isCrossSiteMutation(req('DELETE',{'sec-fetch-site':'cross-site'})),true);
  assert.equal(isCrossSiteMutation(req('PATCH',{origin:'https://m-master.vercel.app.evil.example'})),true);
});
test('동일 출처·안전 메서드·서버간(헤더 없음)은 통과',()=>{
  assert.equal(isCrossSiteMutation(req('POST',{origin:'https://m-master.vercel.app'})),false);
  assert.equal(isCrossSiteMutation(req('GET',{origin:'https://evil.example'})),false);
  assert.equal(isCrossSiteMutation(req('POST')),false);
});
test('requireOrigin 엄격 모드는 동일 출처 증명 필요',()=>{
  assert.equal(hasSameOriginProof(req('POST',{origin:'https://m-master.vercel.app'})),true);
  assert.equal(hasSameOriginProof(req('POST',{'sec-fetch-site':'same-origin'})),true);
  assert.equal(hasSameOriginProof(req('POST')),false);
  assert.equal(hasSameOriginProof(req('POST',{origin:'https://m-master.vercel.app','sec-fetch-site':'cross-site'})),false);
});
