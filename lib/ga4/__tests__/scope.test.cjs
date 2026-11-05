/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require */
require('../../visibility/__tests__/register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
let ownerDomain=true,auto='auto',mapped=null,verified=[];
const queries=[],crossChecks=[];let otherOwnerHolds=false;
require.cache[require.resolve('../../prisma.ts')]={exports:{prisma:{
 domain:{findFirst:async args=>{queries.push(args);return ownerDomain?{id:args.where.id}:null;}},
 setting:{findUnique:async()=>({automationDomainId:auto})},
 ga4Binding:{findFirst:async args=>{if(args.where.ownerId?.not){crossChecks.push(args);return otherOwnerHolds?{id:'x'}:null;}queries.push(args);return mapped;},findMany:async args=>{queries.push(args);return verified;}},
}}};
const {resolveGa4Scope,resolveGa4UrlScope}=require('../scope.ts');
const binding=id=>({id,domainId:'domain',propertyId:'properties/123',host:'example.com',allowedSources:['service_account'],conversionEvents:[],status:'verified'});
test('foreign and missing domains are indistinguishable and every binding read is owner scoped',async()=>{
 ownerDomain=false;assert.deepEqual(await resolveGa4Scope('owner','foreign'),{ok:false,reason:'unmapped'});
 ownerDomain=true;mapped=null;assert.deepEqual(await resolveGa4Scope('owner','unmapped'),{ok:false,reason:'unmapped'});
 mapped=binding('bound');assert.equal((await resolveGa4Scope('owner','domain')).scope.ownerId,'owner');
 assert.ok(queries.every(q=>q.where.ownerId==='owner'));
});
test('an absent automation binding falls back only to a single verified owner binding',async()=>{
 mapped=null;verified=[binding('only')];assert.equal((await resolveGa4Scope('owner')).scope.bindingId,'only');
 verified=[binding('one'),binding('two')];assert.deepEqual(await resolveGa4Scope('owner'),{ok:false,reason:'domain_required'});
 verified=[];assert.deepEqual(await resolveGa4Scope('owner'),{ok:false,reason:'not_configured'});
 mapped={...binding('disabled'),status:'disabled'};assert.deepEqual(await resolveGa4Scope('owner'),{ok:false,reason:'binding_disabled'});
});

test('AB URL host mapping rejects malformed, mixed and ambiguous hosts without the owner default',async()=>{
 verified=[binding('matched')];
 const before=queries.length;
 for(const urls of [['https://example.com/a','https://other.com/b'],[null,'https://example.com/b'],['file:///a','file:///b'],['https://user@example.com/a','https://example.com/b']])assert.deepEqual(await resolveGa4UrlScope('owner',urls),{ok:false,reason:'unmapped'});
 assert.equal(queries.length,before);
 const mapped=await resolveGa4UrlScope('owner',['https://EXAMPLE.com/a','https://example.com/b']);assert.equal(mapped.scope.bindingId,'matched');
 assert.deepEqual(queries.at(-1).where,{ownerId:'owner',host:{in:['example.com','www.example.com']},status:'verified',domain:{ownerId:'owner'}});
 const www=await resolveGa4UrlScope('owner',['https://www.example.com/a','https://example.com/b']);assert.equal(www.scope.bindingId,'matched');
 assert.deepEqual(queries.at(-1).where.host,{in:['example.com','www.example.com']});
 assert.equal((await resolveGa4UrlScope('owner',['https://t-vestra.vercel.app/a','https://example.com/b'])).reason,'unmapped');
 verified=[];assert.equal((await resolveGa4UrlScope('owner',['https://example.com/a','https://example.com/b'])).reason,'unmapped');
 verified=[binding('a'),binding('b')];assert.equal((await resolveGa4UrlScope('owner',['https://example.com/a','https://example.com/b'])).reason,'unmapped');
});

test('레거시 위반: 같은 속성·스트림을 다른 소유자도 연결했다면 실시간(streamId)을 거부, 아니면 유지',async()=>{
 ownerDomain=true;mapped={...binding('rt'),streamId:'555'};
 otherOwnerHolds=false;assert.equal((await resolveGa4Scope('owner','domain')).scope.streamId,'555');
 otherOwnerHolds=true;const scoped=await resolveGa4Scope('owner','domain');
 assert.equal(scoped.ok,true);assert.equal(scoped.scope.streamId,null,'실시간은 unmapped 처리(fetchRealtime)');
 assert.deepEqual(crossChecks.at(-1).where,{ownerId:{not:'owner'},OR:[{propertyId:'properties/123'},{streamId:'555'}]});
 assert.deepEqual(crossChecks.at(-1).select,{id:true},'다른 소유자 값은 읽지 않는다');
 otherOwnerHolds=false;
});
