require("../../visibility/__tests__/register.cjs");
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {freezeSnapshot}=require("../freeze.ts");
const {buildSections}=require("../sections/index.ts");
const {snapshotHash}=require("../hash.ts");
const {parseConsultingSnapshot,consultingSnapshotV2Schema}=require("../../../schemas/consulting.ts");
const {snapshot}=require("./fixtures.cjs");
function fixture(){
 const s=structuredClone(snapshot);
 const at="2026-10-01T00:00:00.000Z";
 const demandId=month=>`demand_${snapshotHash({key:"k1",location:2410,year:2026,month}).slice(0,24)}`;
 const metricId=`metric_${snapshotHash({task:"task",keyword:"k1"}).slice(0,24)}`;
 s.evidence.push(...[7,9].map(month=>({id:demandId(month),source:"seo",label:`kw_demand/task/audit/2410/2026-${month}`,unit:"searches",value:month===7?0:20,observedAt:at})),
   {id:`${metricId}_source`,source:"seo",label:"source",value:"kw_difficulty/task/audit/2410",observedAt:at},
   {id:`${metricId}_difficulty`,source:"seo",label:"difficulty",value:0,observedAt:at});
 s.structuredMetrics={location:2410,period:{from:"2026-07-01T00:00:00.000Z",to:"2026-09-30T00:00:00.000Z"},
   keywords:[{keywordId:"k1",keyword:"a",difficulty:0,volume:0,cpc:0,adCompetition:"LOW",adValue:0,rank:null,rankSource:null,period:null,status:"partial",currency:"KRW",evidenceIds:[`${metricId}_source`,`${metricId}_difficulty`]}],
   demand:[{keywordId:"k1",location:2410,year:2026,month:7,volume:0,evidenceId:demandId(7)},{keywordId:"k1",location:2410,year:2026,month:9,volume:20,evidenceId:demandId(9)}]};
 return s;
}
test("v2 freezes zero and missing months separately; DTO reads remain identical after source mutation",()=>{
 const input=fixture(), frozen=freezeSnapshot(input);
 assert.deepEqual(frozen.sections.summary.monthly.map(m=>m.volume),[0,20]);
 assert.deepEqual(frozen.sections.summary.missingMonths,["2026-08"]);
 assert.equal(frozen.sections.competitors.items,null);
 const stored=JSON.stringify(frozen); input.structuredMetrics.demand[0].volume=999;
 assert.equal(JSON.stringify(parseConsultingSnapshot(JSON.parse(stored),"v2")),stored);
 const second=structuredClone(frozen); second.structuredMetrics.demand.reverse();
 assert.equal(snapshotHash(second),snapshotHash(frozen));
 second.structuredMetrics.demand[0].volume++;
 assert.notEqual(snapshotHash(second),snapshotHash(frozen));
 assert.equal(frozen.sections.focus.items[0].difficulty,0);
});
test("chart evidence survives prompt byte trimming; unknown evidence fails closed",()=>{
 const input=fixture();
 for(let i=0;i<699;i++)input.evidence.push({id:`extra_${i}`,source:"seo",label:"x".repeat(590),value:"x".repeat(590),observedAt:null});
 const frozen=freezeSnapshot(input);
 assert.equal(frozen.evidence.length,input.evidence.length+2);
 assert.ok(frozen.llmInput.evidence.length<frozen.evidence.length);
 assert.ok(frozen.sections.summary.meta.evidenceIds.includes(input.structuredMetrics.demand[0].evidenceId));
 const bad=structuredClone(frozen);bad.sections.summary.monthly[0].evidenceId="absent";
 assert.equal(consultingSnapshotV2Schema.safeParse(bad).success,false);
});
test("v1 retains original schema and degrades new sections; builders never mutate input",()=>{
 const s=structuredClone(snapshot), before=JSON.stringify(s);
 const parsed=parseConsultingSnapshot(s,"v1");
 assert.deepEqual(parsed,s);
 assert.equal(buildSections(parsed).sections.summary.meta.sourceStatus,"missing");
 assert.equal(JSON.stringify(s),before);
 assert.throws(()=>parseConsultingSnapshot(s,"v2"));
});

const {summarySection}=require("../sections/summary.ts");
const {focusSection}=require("../sections/focus.ts");
const {keywordsSection}=require("../sections/keywords.ts");
const {methodologySection}=require("../sections/methodology.ts");
test("focus excludes unlinked, mismatched and wrong-metric values independently, retaining zero",()=>{
 const s=fixture();
 let item=focusSection(s).items[0];
 assert.equal(item.difficulty,0);
 for(const key of ["volume","cpc","adCompetition","adValue"]) assert.equal(item[key],null);
 s.structuredMetrics.keywords[0].difficulty=99;
 assert.equal(focusSection(s).items[0].difficulty,null);
 s.structuredMetrics.keywords[0].evidenceIds=[];
 assert.equal(focusSection(s).meta.sourceStatus,"missing");
});
test("summary rejects demand with mismatched value, keyword, month, location or source",()=>{
 for(const change of [
  s=>s.structuredMetrics.demand[0].volume++,
  s=>s.structuredMetrics.demand[0].keywordId="other",
  s=>s.structuredMetrics.demand[0].month=8,
  s=>s.structuredMetrics.demand[0].location=2840,
  s=>s.evidence.find(e=>e.id===s.structuredMetrics.demand[0].evidenceId).label="kw_ads/task/audit/2410/2026-7",
  s=>s.structuredMetrics.demand[0].evidenceId="absent",
 ]) {
  const s=fixture();change(s);
  const {section,additionalEvidence}=summarySection(s);
  assert.deepEqual(section.monthly.map(m=>m.volume),[20]);
  assert.equal(additionalEvidence.length,1);
  assert.equal(section.meta.coverage,1/3);
 }
});
test("each public section builder accepts frozen evidence and leaves its input unchanged",()=>{
 const s=fixture(), before=JSON.stringify(s);
 Object.freeze(s.evidence);
 for(const builder of [summarySection,focusSection,keywordsSection,methodologySection,buildSections]) builder(s);
 assert.equal(JSON.stringify(s),before);
 assert.equal(summarySection(s).additionalEvidence.length,2);
 const built=buildSections(s);
 assert.equal(built.evidence.length,s.evidence.length+2);
 assert.deepEqual(buildSections({...s,evidence:built.evidence}).sections,built.sections);
});
test("keyword readiness depends on displayed numeric observations including rank and zero",()=>{
 const s=fixture(), k=s.structuredMetrics.keywords[0];
 k.difficulty=k.volume=k.cpc=k.rank=null;
 assert.equal(keywordsSection(s).meta.sourceStatus,"missing");
 for(const key of ["difficulty","volume","cpc","rank"]) {
  k[key]=key==="rank"?1:0;
  assert.notEqual(keywordsSection(s).meta.sourceStatus,"missing");
  k[key]=null;
 }
});
test("ads metrics expose their own periods and methodology distinguishes ads volume from monthly demand",()=>{
 const s=fixture(), k=s.structuredMetrics.keywords[0];
 const base=`metric_${snapshotHash({task:"ads",keyword:k.keywordId}).slice(0,24)}`;
 const at="2026-10-01T00:00:00.000Z";
 k.period={from:"2026-08",to:"2026-09"};k.volume=10;k.cpc=2;k.currency="USD";k.adValue=20;
 for(const [key,value] of Object.entries({source:"kw_ads/ads/audit/2410",volume:10,cpc:2,currency:"USD",adValue:20,period:"2026-08/2026-09"})) {
  const id=`${base}_${key}`;k.evidenceIds.push(id);s.evidence.push({id,source:"seo",label:key,value,observedAt:at});
 }
 const built=buildSections(s).sections,item=built.focus.items[0];
 assert.equal(item.volume,10);assert.equal(item.cpc,2);assert.equal(item.adValue,20);
 for(const key of ["volume","cpc","adValue"]) {
  const e=s.evidence.find(e=>e.id===`${base}_${key}`),original=e.value;e.value=999;
  assert.equal(focusSection(s).items[0][key],null);
  e.value=original;
 }
 const keywordId=k.keywordId;k.keywordId="wrong-keyword";
 assert.equal(focusSection(s).items[0].volume,null);k.keywordId=keywordId;
 assert.deepEqual(item.metricPeriods.volume,k.period);
 assert.deepEqual(item.metricPeriods.cpc,{from:at,to:at});
 for(const section of [built.focus,built.keywords,built.gtm,built.methodology]) assert.equal(section.meta.period,null);
 assert.deepEqual(built.summary.meta.period,s.structuredMetrics.period);
 assert.ok(built.methodology.metricDefs.some(d=>d.key==="volume" && d.source==="kw_ads"));
 assert.ok(built.methodology.metricDefs.some(d=>d.key==="demandVolume" && d.source==="kw_demand"));
 k.period=null;
 assert.equal(focusSection(s).items[0].metricPeriods.volume,undefined);
 k.cpc=null;
 assert.ok(methodologySection(s).metricDefs.some(d=>d.key==="volume" && d.source==="kw_ads"));
});
