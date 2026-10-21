require("../../visibility/__tests__/register.cjs");
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {difficultyRequest,parseDifficulty}=require("../adapters/difficulty.ts");
const {demandRequest,parseDemand}=require("../adapters/demand.ts");
const {adsRequest,parseAds}=require("../adapters/ads.ts");
const {checkpointSchema}=require("../adapters/types.ts");
const {metricUnits}=require("../adapters/metric-contract.ts");
require.cache[require.resolve("../../auth.ts")]={exports:{requireSession:async()=>({user:{id:"owner"}})}};
const {taskPlan}=require("../plan.ts");
const {estimate}=require("../budget.ts");
const input={host:"example.com",market:"ko-KR",engine:"google",keywords:["alpha","beta"],keywordIds:["a","b"],location:2410,language:"ko",units:2,batchIndex:0,
 targetPeriod:{fromYear:2025,fromMonth:11,toYear:2026,toMonth:10}};
const response=rows=>({tasks:[{status_code:20000,result:rows}]});
test("three explicit live requests validate frozen location, units and keyword identity",()=>{
 for(const request of [difficultyRequest,demandRequest,adsRequest]) {
  assert.equal(request(input).units,2);assert.ok(request(input).path.endsWith("/live"));
  assert.throws(()=>request({...input,location:2840}));assert.throws(()=>request({...input,units:1}));
 }
 assert.equal(metricUnits("kw_ads",input),2);
});
test("difficulty rejects fractions, negatives, nonfinite and out-of-range without rounding",()=>{
 for(const value of [-1,101,0.5,NaN,Infinity,"50"]) {
  const cp=parseDifficulty(response([{items:[{keyword:"ＡＬＰＨＡ",keyword_difficulty:value}]}]),input);
  assert.equal(cp.difficulties[0].difficulty,null);assert.ok(cp.issues.length);
 }
 assert.equal(parseDifficulty(response([{items:[{keyword:"alpha",keyword_difficulty:0}]}]),input).difficulties[0].difficulty,0);
 const cp=parseDifficulty(response([{items:[{keyword:"foreign",keyword_difficulty:20}]}]),input);
 assert.equal(cp.difficulties.length,0);assert.ok(cp.issues.includes("unexpected_keyword"));
});
test("demand isolates duplicates, invalid months, missing and zero within frozen period",()=>{
 const cp=parseDemand(response([{items:[{keyword:"alpha",keyword_info:{monthly_searches:[
  {year:2026,month:1,search_volume:0},{year:2026,month:1,search_volume:7},{year:2026,month:13,search_volume:7},
  {year:2026,month:2,search_volume:-1},{year:2024,month:1,search_volume:50}]}}]}]),input);
 assert.equal(cp.demandPoints.length,1);assert.equal(cp.demandPoints[0].volume,0);
 assert.ok(cp.issues.includes("duplicate_month"));assert.ok(cp.issues.includes("invalid_month"));
 assert.ok(parseDemand(response([]),input).issues.includes("empty_result"));
});
test("ads preserves source months separately, defaults currency to USD and keeps range volumes null",()=>{
 const cp=parseAds(response([{keyword:"alpha",cpc:0,search_volume:"10-100",competition:"HIGH",monthly_searches:[{year:2026,month:1,search_volume:0}]}]),input);
 assert.equal(cp.adsMetrics[0].cpc,0);assert.equal(cp.adsMetrics[0].searchVolume,null);
 assert.equal(cp.adsMetrics[0].currency,"USD");assert.equal(cp.demandPoints.length,0);
 assert.deepEqual(checkpointSchema.parse({}).adsMetrics,[]);
});
test("plan and claim units reserve identically; unsupported and invalid prices cannot submit",()=>{
 const old=process.env.SEO_VERIFIED_PRICING_JSON;
 try {
  process.env.SEO_VERIFIED_PRICING_JSON=JSON.stringify({kw_ads:{usdPerUnit:0.1,verifiedAt:new Date(Date.now()-1000).toISOString(),markets:["ko-KR"]}});
  assert.equal(taskPlan("kw_ads","2410:0",input,metricUnits("kw_ads",input)).reservedKrw,estimate("kw_ads",2));
  process.env.SEO_VERIFIED_PRICING_JSON="{}";
  assert.equal(taskPlan("kw_ads","2410:0",input,2).status,"skipped");
  process.env.SEO_VERIFIED_PRICING_JSON=JSON.stringify({kw_ads:{usdPerUnit:0,verifiedAt:new Date().toISOString(),markets:["ko-KR"]}});
  assert.throws(()=>taskPlan("kw_ads","2410:0",input,2));
 } finally {if(old===undefined)delete process.env.SEO_VERIFIED_PRICING_JSON;else process.env.SEO_VERIFIED_PRICING_JSON=old;}
});

test("contract USD does not flag an otherwise complete ads response as partial",()=>{
 const cp=parseAds(response(input.keywords.map(keyword=>({keyword,cpc:2,search_volume:10,competition:"HIGH",monthly_searches:[{year:2026,month:1,search_volume:10}]}))),input);
 assert.deepEqual(cp.issues,[]);assert.ok(cp.adsMetrics.every(r=>r.currency==="USD"));
 const invalid=parseAds(response([{keyword:"alpha",cpc:2,search_volume:10,competition:"HIGH",currency:123,monthly_searches:[{year:2026,month:1,search_volume:10}]}]),input);
 assert.equal(invalid.adsMetrics[0].currency,null);assert.ok(invalid.issues.includes("missing_or_invalid_ads_metric"));
});
