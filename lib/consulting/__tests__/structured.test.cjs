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
 s.evidence.push({id:"month_one",source:"seo",label:"demand",value:0,observedAt:at},{id:"month_two",source:"seo",label:"demand",value:20,observedAt:at});
 s.structuredMetrics={location:2410,period:{from:"2026-07-01T00:00:00.000Z",to:"2026-09-30T00:00:00.000Z"},
   keywords:[{keywordId:"k1",keyword:"a",difficulty:0,volume:0,cpc:0,adCompetition:"LOW",adValue:0,rank:null,rankSource:null,period:null,status:"partial",currency:"KRW",evidenceIds:["month_one"]}],
   demand:[{keywordId:"k1",location:2410,year:2026,month:7,volume:0,evidenceId:"month_one"},{keywordId:"k1",location:2410,year:2026,month:9,volume:20,evidenceId:"month_two"}]};
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
 assert.ok(frozen.sections.summary.meta.evidenceIds.includes("month_one"));
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
