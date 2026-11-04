/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, Request */
require('../../visibility/__tests__/register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
let row,completionInput,writes=0;
require.cache[require.resolve('../../auth.ts')]={exports:{requireSession:async()=>({user:{id:'owner'}})}};
require.cache[require.resolve('../../audit/logger.ts')]={exports:{logAudit:async()=>{},AUDIT_ACTIONS:{AB_TEST_UPDATE:'u',AB_TEST_DELETE:'d'}}};
require.cache[require.resolve('../state.ts')]={exports:{buildCompletionFromGa4:async(ownerId,test)=>{completionInput=test;return {update:{status:'completed'}};}}};
require.cache[require.resolve('../../prisma.ts')]={exports:{prisma:{abTest:{findFirst:async args=>args.where.ownerId==='owner'?row:null,
 update:async args=>{writes++;assert.equal(args.where.ownerId,'owner');return {...row,...args.data};},delete:async args=>{writes++;assert.equal(args.where.ownerId,'owner');return row;}}}}};
const route=require('../../../app/api/ab-test/[id]/route.ts');
const params={params:Promise.resolve({id:'t1'})};
const req=(method,body,headers={origin:'https://app.test'})=>new Request('https://app.test/api/ab-test/t1',{method,headers:{'content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});
const base={id:'t1',ownerId:'owner',status:'running',variantAUrl:'https://www.example.com/a',variantBUrl:'https://www.example.com/b',variantAPath:'/a',variantBPath:'/b',measureDays:7};
test('P1-5: PATCH/DELETE require same-origin and reject unknown fields before any write',async()=>{
 row={...base,status:'draft'};
 for(const headers of [{},{origin:'https://evil.test'},{'sec-fetch-site':'cross-site'}]){
  assert.equal((await route.PATCH(req('PATCH',{action:'cancel'},headers),params)).status,403);
  assert.equal((await route.DELETE(req('DELETE',null,headers),params)).status,403);
 }
 assert.equal((await route.PATCH(req('PATCH',{action:'cancel',owner_id:'x'}),params)).status,400);
 assert.equal(writes,0);
 assert.equal((await route.PATCH(req('PATCH',{action:'cancel'},{'sec-fetch-site':'same-origin'}),params)).status,200);
 assert.equal((await route.DELETE(req('DELETE'),params)).status,200);assert.equal(writes,2);
});
test('N5: completion host and path come from the same final URLs',async()=>{
 row={...base};
 assert.equal((await route.PATCH(req('PATCH',{action:'complete'}),params)).status,200);
 assert.equal(completionInput.variant_a_url,'https://www.example.com/a');assert.equal(completionInput.variant_a_path,'/a');
 assert.equal(completionInput.variant_b_url,'https://www.example.com/b');assert.equal(completionInput.variant_b_path,'/b');
});
