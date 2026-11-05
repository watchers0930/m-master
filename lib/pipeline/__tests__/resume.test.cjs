/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require */
require('../../visibility/__tests__/register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {VisibilityError}=require('../../visibility/errors.ts');
let row=null,existingReport=null,generated=[],finishes=[];const runUpdates=[];
const tx={pipelineRun:{createMany:async()=>({count:row?0:(row={status:'running',attempts:1,leaseUntil:new Date(Date.now()+1e6),id:'r'},1)}),
 findUniqueOrThrow:async()=>row,updateMany:async args=>{runUpdates.push(args);return {count:1};}},$queryRaw:async()=>[]};
require.cache[require.resolve('../../prisma.ts')]={exports:{prisma:{$transaction:async fn=>fn(tx),
 consultingReport:{findFirst:async()=>existingReport}}}};
const {claimPipelineRun,MAX_AUTO_ATTEMPTS}=require('../run-claim.ts');
test('M10/N2: deadline_hit skips are resumable; other skips are final; failed re-claims stop at the attempt cap',async()=>{
 const key={kind:'strategy',ownerId:'o',scopeKey:'d',periodKey:'2026-11-02'};
 row={id:'r',status:'skipped',errorCode:'deadline_hit',attempts:1,leaseUntil:new Date(0)};assert.equal((await claimPipelineRun(key)).acquired,true);
 row={id:'r',status:'skipped',errorCode:'not_configured',attempts:1,leaseUntil:new Date(0)};assert.equal((await claimPipelineRun(key)).acquired,false);
 row={id:'r',status:'failed',errorCode:'strategy_failed',attempts:MAX_AUTO_ATTEMPTS-1,leaseUntil:new Date(0)};assert.equal((await claimPipelineRun(key)).acquired,true);
 row={id:'r',status:'failed',errorCode:'strategy_failed',attempts:MAX_AUTO_ATTEMPTS,leaseUntil:new Date(0)};assert.equal((await claimPipelineRun(key)).acquired,false);
 assert.equal((await claimPipelineRun(key,true)).acquired,true,'manual regenerate is never capped');
});
test('만료된 running(유료 호출 후 persist 전 플랫폼 시간초과)도 시도 상한을 따른다 — 상한에서 failed(lease_expired) 확정',async()=>{
 const key={kind:'content_item',ownerId:'o',scopeKey:'item',periodKey:'2026-11-05'};
 row={id:'r',status:'running',errorCode:null,attempts:MAX_AUTO_ATTEMPTS-1,leaseUntil:new Date(0)};runUpdates.length=0;
 const again=await claimPipelineRun(key);assert.equal(again.acquired,true);assert.equal(again.attempts,MAX_AUTO_ATTEMPTS);
 assert.deepEqual(runUpdates[0].data.attempts,{increment:1},'재claim마다 시도 횟수 증가');
 row={id:'r',status:'running',errorCode:null,attempts:MAX_AUTO_ATTEMPTS,leaseUntil:new Date(0)};runUpdates.length=0;
 const capped=await claimPipelineRun(key);
 assert.equal(capped.acquired,false);assert.equal(capped.status,'failed');assert.equal(capped.errorCode,'lease_expired');
 assert.deepEqual(runUpdates[0].where,{id:'r',attempts:MAX_AUTO_ATTEMPTS,status:'running'});assert.equal(runUpdates[0].data.status,'failed');
 row={id:'r',status:'running',errorCode:null,attempts:MAX_AUTO_ATTEMPTS,leaseUntil:new Date(Date.now()+1e6)};
 assert.equal((await claimPipelineRun(key)).acquired,false,'활성 lease는 그대로 대기');
 row={id:'r',status:'running',errorCode:null,attempts:MAX_AUTO_ATTEMPTS,leaseUntil:new Date(0)};
 assert.equal((await claimPipelineRun(key,true)).acquired,true,'수동 재생성은 상한 없음');
});
test('weekly strategy reuses this week\'s completed report and records deadline_hit as a resumable skip',async()=>{
 const owners=[{ownerId:'a',domainId:'da'},{ownerId:'b',domainId:'db'}];
 require.cache[require.resolve('../owners.ts')]={exports:{pipelineOwners:async function*(){yield* owners;},pipelineOwnerReason:async()=>null,
  expectedSkipReason:e=>e instanceof VisibilityError&&e.code==='deadline_exceeded'?'deadline_hit':null}};
 require.cache[require.resolve('../run-claim.ts')]={exports:{claimPipelineRun:async()=>({acquired:true,id:'r',attempts:1}),
  finishPipelineRun:async(run,status,ref,code)=>{finishes.push([status,code??null,ref?.reportId??null]);}}};
 require.cache[require.resolve('../../consulting/generate.ts')]={exports:{generateReport:async ownerId=>{generated.push(ownerId);
  throw new VisibilityError('deadline_exceeded','x',409);}}};
 const {refreshWeeklyStrategies,weekStartInstant}=require('../weekly-strategy.ts');
 assert.equal(weekStartInstant('2026-11-02').toISOString(),'2026-11-01T15:00:00.000Z');
 let calls=0;require.cache[require.resolve('../../prisma.ts')].exports.prisma.consultingReport.findFirst=async args=>{calls++;
  assert.ok(args.where.generatedAt.gte instanceof Date);return args.where.ownerId==='a'?{id:'manual-report'}:null;};
 const result=await refreshWeeklyStrategies(undefined,Infinity);
 assert.deepEqual(generated,['b']);assert.equal(calls,2);
 assert.deepEqual(finishes,[['succeeded',null,'manual-report'],['skipped','deadline_hit',null]]);
 assert.equal(result.reused,1);assert.equal(result.failed,0);assert.equal(result.deadline_hit,true);
});
