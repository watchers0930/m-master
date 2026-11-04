require('../../visibility/__tests__/register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {VisibilityError}=require('../../visibility/errors.ts');
let reads=0,sent=[],expired=0;
const rows=Array.from({length:26},(_,i)=>({id:String(i).padStart(2,'0'),contentId:String(i),channel:'facebook',scheduledAt:new Date(i)}));
require.cache[require.resolve('../../prisma.ts')]={exports:{prisma:{
 scheduleSlot:{findMany:async args=>{reads++;const cursor=args.where.OR?.[0].scheduledAt.gt;return rows.filter(r=>!cursor||r.scheduledAt>cursor).slice(0,args.take);},updateMany:async()=>({count:1})},
 content:{findMany:async()=>[]},ideaPublishJob:{findMany:async()=>[]},
}}};
require.cache[require.resolve('../owners.ts')]={exports:{pipelineOwners:async function*(){yield {ownerId:'owner'};}}};
require.cache[require.resolve('../../publish/claims.ts')]={exports:{expireClaims:async()=>{expired++;}}};
require.cache[require.resolve('../../publish/service.ts')]={exports:{publishContentNow:async input=>{
 if(input.contentId!=='25')throw new VisibilityError('not_approved','held',409);sent.push(input.contentId);return {};
}}};
const {publishScheduledContent}=require('../schedule-publish.ts');
test('more than twenty held slots do not starve an approved later slot',async()=>{
 const result=await publishScheduledContent(Infinity);assert.equal(reads,2);assert.equal(expired,1);
 assert.equal(result.held,25);assert.deepEqual(sent,['25']);
});
