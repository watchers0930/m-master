require('../../visibility/__tests__/register.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
let calls=0, requests=[], mode='success', source='service_account', version='v1';
const authPath=require.resolve('../auth.ts');
require.cache[authPath]={exports:{credentialCandidates:async()=>[
 {source,version,client:()=>({runReport:async request=>{
   calls++;requests.push(request);
   if(mode==='403')throw {code:403};
   if(mode==='429')throw {code:429};
   return [{rows:[],rowCount:mode==='truncated'?120:0,metadata:{timeZone:'Asia/Seoul'}}];
 },runRealtimeReport:async request=>{
   calls++;requests.push(request);
   return [{rows:[{metricValues:[{value:mode==='bad_realtime'?'invalid':mode==='big_realtime'?'1'.repeat(1048577):'4'}]}]}];
 }})},
]}};
const {runGa4}=require('../run.ts');
const {toGa4Block}=require('../../../types/ga4.ts');
const scope=owner=>({ownerId:owner,domainId:'d',bindingId:'b-'+owner,propertyId:'properties/123',host:'example.com',allowedSources:['service_account'],conversionEvents:[]});
const range={startDate:'2026-10-01',endDate:'2026-10-30'};
const query=(s,key)=>runGa4(s,key,range,async(client,property)=>{
 const [r]=await client.runReport({property,metrics:[{name:'sessions'}],dimensionFilter:{filter:{fieldName:'pagePath',stringFilter:{matchType:'EXACT',value:'/a'}}}});
 return r.rows.length;
});
test('unconfigured results have no data; actual zero is a success block',async()=>{
 const unavailable=await query(undefined,'unconfigured');
 assert.deepEqual(toGa4Block(unavailable),{state:'not_configured'});
 assert.equal('data' in unavailable,false);
 const result=await query(scope('zero'),'zero');
 assert.equal(result.status,'success');assert.equal(result.data,0);
 assert.deepEqual(toGa4Block(result),{state:'ok',data:0,collected_at:result.provenance.collectedAt,host:'example.com',property_id:'properties/123',scope_level:'host'});
 const request=requests.at(-1);
 assert.equal(request.dimensionFilter.andGroup.expressions[0].filter.fieldName,'hostName');
 assert.deepEqual(request.dimensionFilter.andGroup.expressions[0].filter.inListFilter.values,['example.com','www.example.com']);
 assert.equal(request.dimensionFilter.andGroup.expressions[1].filter.fieldName,'pagePath');
});
test('concurrent identical reads share one request; cache is isolated by owner, host, credentials and range',async()=>{
 mode='success';const before=calls;
 await Promise.all([query(scope('cache'),'same'),query(scope('cache'),'same'),query(scope('cache'),'same')]);
 assert.equal(calls-before,1);
 await query(scope('cache'),'same');assert.equal(calls-before,1);
 await query(scope('other'),'same');assert.equal(calls-before,2);
 await query({...scope('cache'),host:'www.example.com'},'same');assert.equal(calls-before,2,'apex and www. are one host scope');
 await query({...scope('cache'),host:'other.example.com'},'same');assert.equal(calls-before,3);
 version='v2';await query(scope('cache'),'same');assert.equal(calls-before,4);
});
test('403 suppression never crosses owner or credential version; 429 is never cached',async()=>{
 mode='403';version='deny';const before=calls;
 const denied=await query(scope('denied'),'first');
 assert.equal(denied.status,'error');assert.equal(denied.code,'permission_denied');assert.equal('data' in denied,false);
 await query(scope('denied'),'second');assert.equal(calls-before,1);
 mode='success';await query(scope('healthy'),'second');assert.equal(calls-before,2);
 version='renewed';await query(scope('denied'),'second');assert.equal(calls-before,3);
 mode='429';const a=await query(scope('limited'),'quota'),b=await query(scope('limited'),'quota');
 assert.equal(a.code,'quota_exceeded');assert.equal(b.retryable,true);assert.equal(calls-before,5);
 mode='success';
});
test('timeouts and invalid credentials are explicit errors without invented observations',async()=>{
 const result=await runGa4(scope('timeout'),'timeout',range,()=>new Promise(()=>{}),0,5);
 assert.equal(result.status,'error');assert.equal(result.code,'timeout');
 assert.equal('data' in result,false);
});

test('row truncation is partial; realtime uses streamId and inspects metrics and payload size',async()=>{
 mode='truncated';const partial=await query(scope('truncated'),'truncated');
 assert.equal(partial.provenance.completeness,'partial');assert.equal(partial.provenance.quality.truncatedRows,true);
 const realtime=(owner)=>runGa4({...scope(owner),streamId:'1234'},'realtime',range,async(client,property)=>{
  const [result]=await client.runRealtimeReport({property,metrics:[{name:'activeUsers'}],dimensionFilter:{filter:{fieldName:'platform',stringFilter:{value:'web'}}}});
  return Number(result.rows[0].metricValues[0].value);
 });
 mode='success';const good=await realtime('realtime-good');assert.equal(good.data,4);assert.equal(good.provenance.scopeLevel,'stream');
 assert.equal(toGa4Block(good).scope_level,'stream');
 const filters=requests.at(-1).dimensionFilter.andGroup.expressions;
 assert.equal(filters[0].filter.fieldName,'streamId');assert.equal(filters[0].filter.stringFilter.value,'1234');
 assert.equal(filters[1].filter.fieldName,'platform');
 for(const invalid of ['bad_realtime','big_realtime']) {mode=invalid;const result=await realtime(invalid);assert.equal(result.status,'error');assert.equal('data' in result,false);}
 mode='success';
 const {fetchRealtime}=require('../visitors.ts');const before=calls;
 assert.deepEqual(await fetchRealtime(scope('missing-stream')),{status:'unavailable',reason:'unmapped'});assert.equal(calls,before);
});

test('host aliasing: apex and www. are equivalent in the single shared filter; other hosts stay excluded',()=>{
 const {normalizeGa4Host,ga4HostVariants}=require('../host.ts');const {hostFilter}=require('../run.ts');
 for(const host of ['vestra.ai.kr','www.vestra.ai.kr','WWW.Vestra.AI.kr.']) {
  assert.equal(normalizeGa4Host(host),'vestra.ai.kr');
  assert.deepEqual(hostFilter({host,propertyId:'properties/536963348'},{}).dimensionFilter.filter.inListFilter.values,['vestra.ai.kr','www.vestra.ai.kr']);
 }
 const allowed=ga4HostVariants('vestra.ai.kr');
 for(const other of ['t-vestra.vercel.app','localhost','vestra-plum.vercel.app','www.t-vestra.vercel.app','evil-vestra.ai.kr']) assert.equal(allowed.includes(other),false);
 assert.equal(normalizeGa4Host('www.com'),'www.com');assert.deepEqual(ga4HostVariants('localhost'),['localhost']);
});
test('explicit top-N limits are not truncation; implicit default limits still mark partial',async()=>{
 mode='truncated';
 const topN=await runGa4(scope('topn'),'topn',range,async(client,property)=>{await client.runReport({property,metrics:[{name:'sessions'}],limit:10});return 1;});
 assert.equal(topN.provenance.completeness,'complete');assert.equal(topN.provenance.quality.truncatedRows,false);
 const implicit=await runGa4(scope('implicit'),'implicit',range,async(client,property)=>{await client.runReport({property,metrics:[{name:'sessions'}]});return 1;});
 assert.equal(implicit.provenance.completeness,'partial');assert.equal(requests.at(-1).limit,100);
 mode='success';
});
