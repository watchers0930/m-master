/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, Request */
require('../../visibility/__tests__/register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Prisma}=require('@prisma/client');
let wheres=[],automation='auto-domain';
require.cache[require.resolve('../../auth.ts')]={exports:{requireSession:async()=>({user:{id:'owner'}})}};
require.cache[require.resolve('../../prisma.ts')]={exports:{prisma:{setting:{findUnique:async()=>({automationDomainId:automation})},
 domain:{findFirst:async args=>args.where.ownerId==='owner'&&args.where.id==='mine'?{id:'mine'}:null},
 topicRecommendation:{findMany:async args=>{wheres.push(args.where);return [];}}}}};
const route=require('../../../app/api/topics/route.ts');
const get=q=>route.GET(new Request('https://app.test/api/topics'+q));
test('N6/M7: reads use the same owner+domain scope as persistTopics; legacy rows without domainId never match',async()=>{
 assert.equal((await get('')).status,200);
 assert.deepEqual(wheres.at(-1).factors,{path:['domainId'],equals:'auto-domain'});assert.equal(wheres.at(-1).ownerId,'owner');
 automation=null;await get('');assert.equal(wheres.at(-1).factors.equals,Prisma.JsonNull);
 assert.equal((await get('?domain_id=mine')).status,200);assert.equal(wheres.at(-1).factors.equals,'mine');
 const before=wheres.length;
 assert.equal((await get('?domain_id=foreign')).status,404);
 assert.equal((await get('?domain_id=mine&domain_id=mine')).status,400);
 assert.equal((await get('?owner_id=x')).status,400);assert.equal(wheres.length,before);
});
