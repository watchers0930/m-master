require('../../visibility/__tests__/register.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {snapshot}=require('./fixtures.cjs');
let row, events=[];
const owner='owner', domainId='domain';
const tx={
 domain:{findFirst:async()=>({id:domainId})},
 consultingReport:{
  findMany:async()=>[],
  findFirst:async({where})=>row&&row.ownerId===where.ownerId&&row.inputSnapshotHash===where.inputSnapshotHash?{...row}:null,
  update:async({data})=>(row={...row,...data}),
  create:async({data})=>(row={id:'report',...data}),
  updateMany:async({where,data})=>{
   const match=row&&Object.entries(where).every(([k,v])=>v&&typeof v==='object'&&v.in?v.in.includes(row[k]):row[k]===v);
   if(match)row={...row,...data};return {count:match?1:0};
  },
 },
 auditLog:{create:async({data})=>{events.push({...data,createdAt:new Date()});},count:async({where})=>events.filter(e=>e.actor===where.actor&&e.action===where.action&&e.createdAt>=where.createdAt.gte).length},
};
let chain=Promise.resolve();
const db={...tx,$transaction:fn=>{const pending=chain.then(()=>fn(tx));chain=pending.catch(()=>{});return pending;}};
require.cache[require.resolve('../../auth.ts')]={exports:{requireSession:async()=>({user:{id:owner}})}};
require.cache[require.resolve('../../prisma.ts')]={exports:{prisma:db}};
require.cache[require.resolve('../../visibility/queries.ts')]={exports:{lockOwner:async()=> 'starter'}};
require.cache[require.resolve('../../seo/budget.ts')]={exports:{checkSeoBudget:async()=>{}}};
const {claimReport,beginAttempt,canRetry}=require('../data.ts');
const {markRejected,markUncertain}=require('../budget.ts');
const versions={schemaVersion:'v1',promptVersion:'consulting-v1',model:'test'};
const claim=id=>claimReport(owner,domainId,snapshot,'hash',versions,id,367);
test('only confirmed unbilled failures can acquire a fresh attempt',()=>{
 const base={status:'failed',ledgerId:null,reservedKrw:0,startedAt:null,failCode:'expired_unstarted'};
 assert.equal(canRetry(base),true);
 assert.equal(canRetry({...base,startedAt:new Date(),failCode:'request_rejected'}),true);
 for(const patch of [{status:'completed'},{status:'uncertain'},{ledgerId:'paid'},{reservedKrw:367},{startedAt:new Date()}])
  assert.equal(canRetry({...base,...patch}),false);
});
test('concurrent safe retries reserve once, fence old workers and preserve uncertain holds',async()=>{
 row={id:'report',ownerId:owner,domainId,inputSnapshotHash:'hash',status:'failed',failCode:'expired_unstarted',startedAt:null,ledgerId:null,reservedKrw:0};events=[];
 const claims=await Promise.all([claim('new-a'),claim('new-b')]);
 assert.equal(claims.filter(x=>x.claimed).length,1);
 assert.equal(events.filter(x=>x.action==='consulting.reserve').length,1);
 assert.equal(row.reservedKrw,367);
 await assert.rejects(beginAttempt(owner,row.id,'old'),e=>e.code==='generation_uncertain');
 await beginAttempt(owner,row.id,'new-a');
 await markUncertain(owner,row.id,'new-a');
 assert.equal(row.status,'uncertain');assert.equal(row.reservedKrw,367);
 assert.equal((await claim('new-c')).claimed,false);
 await assert.rejects(markRejected(owner,row.id,'old'));
 assert.equal(row.reservedKrw,367);
 await markRejected(owner,row.id,'new-a');
 assert.equal(row.status,'failed');assert.equal(row.reservedKrw,0);
});
test('rejected and deleted reports do not reset the durable rolling quota',async()=>{
 process.env.CONSULTING_GENERATION_LIMIT='1';process.env.CONSULTING_GENERATION_WINDOW_SECONDS='3600';
 try {
  await assert.rejects(claim('rate-blocked'),e=>e.code==='rate_limited');
  row=null;
  await assert.rejects(claim('deleted-rate-blocked'),e=>e.code==='rate_limited');
  assert.equal(row,null);assert.equal(events.filter(x=>x.action==='consulting.reserve').length,1);
 } finally {delete process.env.CONSULTING_GENERATION_LIMIT;delete process.env.CONSULTING_GENERATION_WINDOW_SECONDS;}
});
