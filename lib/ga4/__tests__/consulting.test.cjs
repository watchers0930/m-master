require('../../visibility/__tests__/register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
let mode='full',requests=[],batches=0;
require.cache[require.resolve('../scope.ts')]={exports:{resolveGa4Scope:async(ownerId,domainId)=>({ok:true,scope:{ownerId,domainId,bindingId:'binding',propertyId:'properties/123',host:'example.com',allowedSources:['service_account'],conversionEvents:['contact_submit']}})}};
require.cache[require.resolve('../auth.ts')]={exports:{credentialCandidates:async()=>[{source:'service_account',version:mode,client:()=>({batchRunReports:async request=>{
 requests.push(request);batches++;
 if(mode==='error')throw {code:429};
 const reports=request.requests.map((report,index)=>({rows:[{dimensionValues:[{value:index===4?'form_start':'/landing\u0001'}],metricValues:report.metrics.map(()=>({value:'0'}))}],
 totals:[{metricValues:report.metrics.map(()=>({value:'0'}))}],metadata:{timeZone:'Asia/Seoul',subjectToThresholding:true}}));
 return [{reports:mode==='partial'?reports.slice(0,4):reports}];
}})}]}};
const {collectGa4}=require('../../consulting/ga4-collect.ts');
const {ga4Evidence}=require('../../consulting/ga4-evidence.ts');
const {freezeSnapshot}=require('../../consulting/freeze.ts');
const {parseConsultingSnapshot}=require('../../../schemas/consulting.ts');
const {snapshotHash}=require('../../consulting/hash.ts');
const range={from:'2026-10-01T00:00:00.000Z',to:'2026-10-30T23:59:59.999Z'};
test('five bounded reports share one host-scoped batch; observed zero and form-start labeling survive v3 freeze',async()=>{
 mode='full';const result=await collectGa4('owner','domain',range);
 assert.equal(result.status,'success');assert.equal(batches,1);
 assert.equal(requests[0].requests.length,5);
 for(const request of requests[0].requests){assert.equal(request.limit,20);assert.deepEqual(request.metricAggregations,[1]);}
 const events=requests[0].requests[4].dimensionFilter.andGroup.expressions;
 assert.equal(events[0].filter.fieldName,'hostName');assert.deepEqual(events[1].filter.inListFilter.values,['form_start','contact_submit']);
 const ga4=ga4Evidence(result);
 assert.equal(ga4.evidence.find(e=>e.id==='ga4_events_0_eventCount').value,0);
 assert.equal(ga4.evidence.find(e=>e.id==='ga4_events_0_eventCount').label,'폼 시작 이벤트 이벤트 수');
 assert.equal(result.data.reports.landing[0].key,'/landing');
 const input={market:'ko-KR',range,monthlyMarketingBudget:null,selection:[],...ga4};
 const frozen=freezeSnapshot(input,'v3');
 assert.equal(parseConsultingSnapshot(frozen,'v3').ga4.provenance.host,'example.com');
 assert.equal(frozen.sourceStatus[0].status,'available');
 const changed=structuredClone(frozen);
 for(const projection of [changed,changed.llmInput]){
  projection.ga4.provenance.collectedAt='2026-11-04T11:00:00.000Z';
  projection.evidence.filter(e=>e.source==='ga4').forEach(e=>e.observedAt='2026-11-04T11:00:00.000Z');
  projection.sourceStatus.filter(s=>s.source==='ga4').forEach(s=>s.observedAt='2026-11-04T11:00:00.000Z');
 }
 assert.equal(snapshotHash(changed),snapshotHash(frozen));
 changed.ga4.reports.channels[0].sessions=1;assert.notEqual(snapshotHash(changed),snapshotHash(frozen));
});
test('partial reports preserve failed query provenance and all-failure has no numeric evidence',async()=>{
 mode='partial';const result=await collectGa4('partial','domain',range);
 assert.equal(result.status,'success');assert.equal(result.data.provenance.completeness,'partial');
 assert.deepEqual(result.data.failedQueries,[{report:'events',code:'upstream_error'}]);
 assert.equal(ga4Evidence(result).sourceStatus[0].status,'partial');
 mode='error';const failure=await collectGa4('failed','domain',range);
 assert.equal(failure.status,'error');assert.equal(failure.code,'quota_exceeded');
 assert.equal(ga4Evidence(failure).sourceStatus[0].status,'error');assert.equal(ga4Evidence(failure).evidence.length,0);
});
