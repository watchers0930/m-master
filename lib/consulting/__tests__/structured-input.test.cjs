require("../../visibility/__tests__/register.cjs");
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {readStructuredInput}=require("../structured-input.ts");
function fixture() {
 const keywords=Array.from({length:50},(_,i)=>({id:`key${i}`,keyword:`word${i}`,normalizedKeyword:`word${i}`}));
 const demandPoints=keywords.flatMap(k=>Array.from({length:12},(_,i)=>({keyword:k.normalizedKeyword,location:2410,
   year:i<3?2025:2026,month:(i+9)%12+1,volume:i})));
 const tasks=Array.from({length:50},(_,i)=>({id:`task${i}`,auditId:`audit${i}`,operation:"kw_demand",
   frozenInput:{location:2410,market:"ko-KR",keywordIds:keywords.map(k=>k.id),keywords:keywords.map(k=>k.normalizedKeyword)},
   resultCheckpoint:{observedAt:"2026-10-01T00:00:00.000Z",demandPoints}}));
 const points=demandPoints.map(d=>({...d,keywordId:keywords.find(k=>k.normalizedKeyword===d.keyword).id,auditId:"audit149"}));
 const rankings=[];
 const tx={$queryRaw:async query=>query.sql.includes("seo_tasks")?tasks:rankings,seoKeyword:{findMany:async()=>keywords,count:async()=>50},seoTask:{findMany:async()=>tasks},
   seoRanking:{findMany:async()=>[]},seoDemandPoint:{findMany:async()=>points}};
 const snapshot={market:"ko-KR",range:{to:"2026-10-20T00:00:00.000Z"},selection:[],evidence:[],limitations:[]};
 return {tx,snapshot,tasks,points,rankings};
}
test("upper-bound demand provenance matches keyword, location, month and value including zero",async()=>{
 const {tx,snapshot}=fixture();
 const result=await readStructuredInput(tx,"owner","domain",snapshot);
 assert.equal(result.demand.length,600);
 assert.equal(result.demand.filter(d=>d.volume===0).length,50);
 assert.equal(snapshot.evidence.filter(e=>e.id.startsWith("demand_")).length,600);
 assert.ok(snapshot.evidence.every(e=>e.label.includes("task0")));
});
test("mismatched value, location, keyword mapping and missing checkpoint are excluded",async()=>{
 for(const change of [
   f=>{f.points[0].volume=999;},
   f=>{f.points[0].location=2840;}, f=>{f.tasks.forEach(t=>t.frozenInput.keywords[0]="wrong");},
   f=>{f.tasks.forEach(t=>t.resultCheckpoint=null);},
 ]) {
  const f=fixture(); change(f);
  const result=await readStructuredInput(f.tx,"owner","domain",f.snapshot);
  assert.ok(result.demand.length<600);
  assert.equal(f.snapshot.limitations.length,1);
 }
});
test("duplicate provenance selects the first ordered task deterministically",async()=>{
 const f=fixture();
 f.tasks[0].auditId="audit149";
 const result=await readStructuredInput(f.tx,"owner","domain",f.snapshot);
 assert.equal(result.demand.length,600);
 assert.ok(f.snapshot.evidence.every(e=>e.label.includes("task0/")));
});

test("recaptured audit IDs retain matching historical demand but changed values are excluded",async()=>{
 const f=fixture();
 f.points.forEach(p=>p.auditId="today");
 const read=f.tx.seoDemandPoint.findMany;
 f.tx.seoDemandPoint.findMany=async query=>{
  assert.equal(query.where.audit.createdAt,undefined);
  return read(query);
 };
 assert.equal((await readStructuredInput(f.tx,"owner","domain",f.snapshot)).demand.length,600);
 f.points[0].volume=999;
 assert.equal((await readStructuredInput(f.tx,"owner","domain",f.snapshot)).demand.length,599);
});
test("rank-only keywords are partial and default USD produces ad value with task provenance",async()=>{
 const f=fixture(); f.tasks.length=0; f.points.length=0;
 f.rankings.push({id:"rank",keywordId:"key0",rank:3,status:"ranked",capturedAt:new Date(f.snapshot.range.to)});
 const {parseAds}=require("../../seo/adapters/ads.ts");
 const input={host:"example.com",market:"ko-KR",engine:"google",keywords:["word1"],keywordIds:["key1"],location:2410,language:"ko",units:1,batchIndex:0};
 const cp=parseAds({tasks:[{status_code:20000,result:[{keyword:"word1",cpc:2,search_volume:10,competition:"HIGH",monthly_searches:[{year:2026,month:9,search_volume:10}]}]}]},input);
 cp.observedAt=f.snapshot.range.to;
 f.tasks.push({id:"ads",auditId:"audit",operation:"kw_ads",frozenInput:input,resultCheckpoint:cp});
 const result=await readStructuredInput(f.tx,"owner","domain",f.snapshot);
 assert.equal(result.keywords[0].status,"partial");assert.equal(result.keywords[0].rank,3);
 assert.equal(result.keywords[1].currency,"USD");assert.equal(result.keywords[1].adValue,20);
 assert.equal(result.keywords[2].status,"missing");
});

test("empty and all-null checkpoints retain provenance but stay missing; observed zero is partial",async()=>{
 for (const checkpoint of [
  {},
  {difficulties:[{keyword:"word0",difficulty:null}]},
  {adsMetrics:[{keyword:"word0",searchVolume:null,cpc:null,adCompetition:"HIGH",currency:"USD",monthly:[]}]},
  {difficulties:[{keyword:"word0",difficulty:0}]},
  {adsMetrics:[{keyword:"word0",searchVolume:0,cpc:null,adCompetition:null,currency:null,monthly:[]}]},
  {adsMetrics:[{keyword:"word0",searchVolume:null,cpc:0,adCompetition:null,currency:null,monthly:[]}]},
 ]) {
  const f=fixture(); f.tasks.length=0; f.points.length=0;
  f.tasks.push({id:"metric",auditId:"audit",operation:checkpoint.adsMetrics?"kw_ads":"kw_difficulty",
   frozenInput:{location:2410,market:"ko-KR",keywordIds:["key0"],keywords:["word0"]},
   resultCheckpoint:{...checkpoint,observedAt:f.snapshot.range.to}});
  const {keywords}=await readStructuredInput(f.tx,"owner","domain",f.snapshot);
  const hasValue=checkpoint.difficulties?.[0].difficulty===0 || checkpoint.adsMetrics?.[0].searchVolume===0 || checkpoint.adsMetrics?.[0].cpc===0;
  assert.equal(keywords[0].status,hasValue?"partial":"missing");
  assert.ok(keywords[0].evidenceIds.some(id=>id.endsWith("_source")));
 }
});
