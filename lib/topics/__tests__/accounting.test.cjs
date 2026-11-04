require('../../visibility/__tests__/register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const events=[];let failPersist=false;
function mock(id,exports){require.cache[require.resolve(id)]={exports};}
mock('../../auth.ts',{requireSession:async()=>{throw Error('unused');}});
mock('../../prisma.ts',{prisma:{
 setting:{findUnique:async()=>({brandGuide:{}})},content:{findMany:async()=>[]},
 costLedger:{create:async()=>{events.push('ledger');}},
}});
mock('../../billing/limits.ts',{getUserPlan:async()=> 'pro',checkCostLimit:async()=>{}});
mock('../../ga4/scope.ts',{resolveGa4Scope:async()=>({ok:false,reason:'not_configured'})});
mock('../../pipeline/run-claim.ts',{claimPipelineRun:async()=>({acquired:true,id:'run',attempts:1}),finishPipelineRun:async()=>{events.push('finish');}});
mock('../strategy-candidates.ts',{strategyCandidates:async()=>({candidates:[{topic:'trusted',signal:'strategy',weight:10,candidateId:'c0'}],strategy:{reportId:null,reason:'no_completed_report'}})});
mock('../visibility-gap.ts',{visibilityGapCandidates:async()=>[]});
mock('../candidates.ts',{buildCandidates:()=>[]});
mock('../recommend.ts',{recommendTopFive:async input=>{
 await input.onUsage({prompt_tokens:10,completion_tokens:10});events.push('returned');
 return {usage:{prompt_tokens:10,completion_tokens:10},items:[{candidateIndex:failPersist?1:99,score:80,tags:[],reason:'test'}]};
}});
mock('../persist.ts',{persistTopics:async()=>{events.push('persist');throw Error('database write failed');}});
const {refreshTopics}=require('../service.ts');
test('paid usage commits before candidate validation and survives result persistence failure',async()=>{
 for(const persist of [false,true]){
  failPersist=persist;events.length=0;
  await assert.rejects(refreshTopics({ownerId:'owner',domainId:null,weekStart:'2026-11-02',mode:'auto',channel:'blog'}),e=>e.code==='recommend_failed');
  assert.deepEqual(events,persist?['ledger','returned','persist','finish']:['ledger','returned','finish']);
 }
});
