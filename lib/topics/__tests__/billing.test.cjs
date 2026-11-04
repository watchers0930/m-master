/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, Headers */
require('../../visibility/__tests__/register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {APIConnectionTimeoutError,APIConnectionError,APIError}=require('openai');
let finishes=[],behavior;
function mock(id,exports){require.cache[require.resolve(id)]={exports};}
mock('../../auth.ts',{requireSession:async()=>{throw Error('unused');}});
mock('../../prisma.ts',{prisma:{setting:{findUnique:async()=>({brandGuide:{}})},content:{findMany:async()=>[]},costLedger:{create:async()=>{}}}});
mock('../../billing/limits.ts',{getUserPlan:async()=> 'pro',checkCostLimit:async()=>{}});
mock('../../ga4/scope.ts',{resolveGa4Scope:async()=>({ok:false,reason:'not_configured'})});
mock('../../pipeline/run-claim.ts',{claimPipelineRun:async()=>({acquired:true,id:'run',attempts:1}),finishPipelineRun:async(run,status,ref,code)=>{finishes.push([status,code]);}});
mock('../strategy-candidates.ts',{strategyCandidates:async()=>({candidates:[{topic:'t',signal:'strategy',weight:10,candidateId:'c0'}],strategy:{reportId:null,reason:'no_completed_report'}})});
mock('../visibility-gap.ts',{visibilityGapCandidates:async()=>[]});
mock('../candidates.ts',{buildCandidates:()=>[]});
mock('../persist.ts',{persistTopics:async()=>[]});
mock('../recommend.ts',{recommendTopFive:async input=>behavior(input)});
const {refreshTopics}=require('../service.ts');
const run=()=>refreshTopics({ownerId:'o',domainId:null,weekStart:'2026-11-02',mode:'auto',channel:'blog'});
test('N3: only a possibly-billed request becomes skipped/billing_uncertain; no-response failures stay re-claimable',async()=>{
 const cases=[
  ['pre-dispatch error',()=>{throw Error('OPENAI_API_KEY 환경변수 미설정');},'failed','recommend_failed'],
  ['client timeout',input=>{input.onDispatch();throw new APIConnectionTimeoutError();},'failed','recommend_failed'],
  ['connection refused',input=>{input.onDispatch();throw new APIConnectionError({message:'ECONNREFUSED'});},'failed','recommend_failed'],
  ['definitive 429',input=>{input.onDispatch();throw APIError.generate(429,{},'rate',new Headers());},'failed','recommend_failed'],
  ['5xx after dispatch',input=>{input.onDispatch();throw APIError.generate(500,{},'boom',new Headers());},'skipped','billing_uncertain'],
  ['response without usage',input=>{input.onDispatch();throw Error('usage_missing');},'skipped','billing_uncertain'],
  ['failure after usage recorded',async input=>{input.onDispatch();await input.onUsage({prompt_tokens:1,completion_tokens:1});throw Error('later');},'failed','recommend_failed'],
 ];
 for(const [name,fn,status,code] of cases){
  finishes=[];behavior=fn;
  await assert.rejects(run(),e=>e.code==='recommend_failed',name);
  assert.deepEqual(finishes,[[status,code]],name);
 }
});
