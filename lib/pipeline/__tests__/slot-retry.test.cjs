/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require */
require('../../visibility/__tests__/register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const slots=[{id:'s1',contentId:'c1',channel:'facebook',scheduledAt:new Date(0),retryCount:0},{id:'s2',contentId:'c2',channel:'instagram',scheduledAt:new Date(1),retryCount:2}];
const updates=[];let findWhere;
require.cache[require.resolve('../../prisma.ts')]={exports:{prisma:{
 scheduleSlot:{findMany:async args=>{findWhere=args.where;return slots;},updateMany:async args=>{updates.push(args);return {count:1};}},
 content:{findMany:async()=>[]},ideaPublishJob:{findMany:async()=>[]},
}}};
require.cache[require.resolve('../owners.ts')]={exports:{pipelineOwners:async function*(){yield {ownerId:'owner'};}}};
require.cache[require.resolve('../../publish/claims.ts')]={exports:{expireClaims:async()=>{}}};
require.cache[require.resolve('../../publish/service.ts')]={exports:{publishContentNow:async()=>{throw Object.assign(new Error('token=SECRET'),{name:'FetchError'});}}};
const {publishScheduledContent,MAX_SLOT_RETRIES}=require('../schedule-publish.ts');
test('L9: failed social slots count retries (code only) and are parked as failed at the cap',async()=>{
 const result=await publishScheduledContent(Infinity);
 assert.deepEqual(findWhere.retryCount,{lt:MAX_SLOT_RETRIES});
 assert.deepEqual(result.social,[{slot_id:'s1',status:'failed'},{slot_id:'s2',status:'failed_final'}]);
 assert.deepEqual(updates[0].data,{retryCount:{increment:1},lastError:'FetchError'});
 assert.deepEqual(updates[1].data,{retryCount:{increment:1},lastError:'FetchError',status:'failed'});
 assert.equal(updates[1].where.retryCount,2);assert.equal(JSON.stringify(updates).includes('SECRET'),false);
});
