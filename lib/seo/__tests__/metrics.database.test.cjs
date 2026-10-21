require("../../visibility/__tests__/register.cjs");
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const {execFileSync}=require("node:child_process");
const {createRequire}=require("node:module");
const packageDir=process.env.PGLITE_SOCKET_PACKAGE;
test("isolated P1 migration, reservations, writer ordering, snapshot and tenant isolation",{skip:!packageDir&&"Set PGLITE_SOCKET_PACKAGE"},async t=>{
 const runtime=createRequire(path.join(packageDir,"package.json"));
 const {PGlite}=runtime("@electric-sql/pglite"),{PGLiteSocketServer}=runtime("@electric-sql/pglite-socket");
 const {PrismaClient}=require("@prisma/client");
 const db=await PGlite.create();let server,client;
 const oldPrices=process.env.SEO_VERIFIED_PRICING_JSON;
 try {
  const root=path.resolve(__dirname,"../../..");
  const ddl=execFileSync(path.join(root,"node_modules/.bin/prisma"),["migrate","diff","--from-empty","--to-schema-datamodel",path.join(root,"prisma/schema.prisma"),"--script"],{encoding:"utf8"})
    .replace(/CREATE EXTENSION[^;]*;/g,"").replace(/vector\(1536\)/g,"TEXT");
  const baseline=ddl.split(";").filter(s=>!/(?:CREATE TABLE|CREATE (?:UNIQUE )?INDEX|ALTER TABLE) "seo_demand_points(?:"|_)/.test(s)).join(";")
    .replace(/    "(?:difficulty|cpc|ad_competition|ad_value)"[^\n]*\n/g,"");
  await db.exec(baseline);
  await db.exec("DROP INDEX seo_tasks_frozen_input_path_idx");
  await db.exec(`INSERT INTO users(id,email,password_hash,updated_at,plan) VALUES ('owner','p1@example.test','unused',now(),'pro'),('foreign','foreign@example.test','unused',now(),'pro');
    INSERT INTO domains(id,owner_id,url) VALUES ('legacy-domain','owner','legacy.example');
    INSERT INTO seo_keywords(id,domain_id,keyword,normalized_keyword,market,engine,competition,updated_at) VALUES ('legacy-keyword','legacy-domain','legacy','legacy','ko-KR','google',0.25,now());`);
  const sql=fs.readFileSync(path.join(root,"prisma/manual-migrations/20261021_minteq_structured_report_p1.sql"),"utf8");
  const [transactionSql, concurrentSql, indexValidation] = sql.split(/(?=CREATE INDEX CONCURRENTLY)|(?<=jsonb_path_ops\);)\n/);
  async function migrate() {
   await db.exec(transactionSql);
   await db.exec(concurrentSql);
   await db.exec(indexValidation);
  }
  await t.test("additive SQL applies twice and preserves float; incompatible columns fail",async()=>{
   await migrate();await migrate();
   assert.equal((await db.query("SELECT competition FROM seo_keywords WHERE id='legacy-keyword'")).rows[0].competition,0.25);
   for(const drift of ['DROP INDEX seo_tasks_frozen_input_path_idx; CREATE INDEX seo_tasks_frozen_input_path_idx ON seo_tasks USING GIN(frozen_input jsonb_ops)',
     'ALTER TABLE seo_keywords ALTER COLUMN cpc TYPE INTEGER',
     'DROP INDEX seo_demand_points_domain_id_market_location_idx; CREATE INDEX seo_demand_points_domain_id_market_location_idx ON seo_demand_points(market)',
     'ALTER TABLE seo_demand_points DROP CONSTRAINT seo_demand_points_domain_id_fkey; ALTER TABLE seo_demand_points ADD CONSTRAINT seo_demand_points_domain_id_fkey FOREIGN KEY(domain_id) REFERENCES domains(id)']) {
    await db.exec('BEGIN;'+drift+';');await assert.rejects(db.exec(transactionSql.replace("COMMIT;", "")+indexValidation));await db.exec('ROLLBACK');
   }
  });
  await t.test("migration preserves a valid GIN index and rebuilds an INVALID index on rerun",async()=>{
   const index=async()=> (await db.query("SELECT indexrelid, indisvalid FROM pg_index WHERE indexrelid=to_regclass('seo_tasks_frozen_input_path_idx')")).rows[0];
   const valid=await index();
   await migrate();
   assert.deepEqual(await index(),valid);
   // Reproduce the catalog state left behind by a failed concurrent build.
   await db.exec("UPDATE pg_index SET indisvalid=false WHERE indexrelid=to_regclass('seo_tasks_frozen_input_path_idx')");
   assert.equal((await index()).indisvalid,false);
   await migrate();
   const rebuilt=await index();
   assert.equal(rebuilt.indisvalid,true);assert.notEqual(rebuilt.indexrelid,valid.indexrelid);
   await migrate();assert.deepEqual(await index(),rebuilt);
  });
  await t.test("provenance containment supports the migration GIN index", async () => {
   await db.exec("SET enable_seqscan=off");
   try {
    const plan = await db.query(`EXPLAIN SELECT id FROM seo_tasks WHERE frozen_input @> '{"keywordIds":["key"]}'::jsonb`);
    assert.match(JSON.stringify(plan.rows), /seo_tasks_frozen_input_path_idx/);
   } finally { await db.exec("RESET enable_seqscan"); }
  });
  server=new PGLiteSocketServer({db,port:0,host:"127.0.0.1"});await server.start();
  const conn=server.getServerConn(),address=conn.startsWith("postgres")?conn:`postgresql://postgres:postgres@${conn}/postgres`;
  client=new PrismaClient({datasources:{db:{url:address+(address.includes("?")?"&":"?")+"connection_limit=1&sslmode=disable"}}});
  require.cache[require.resolve("../../prisma.ts")]={exports:{prisma:client}};
  require.cache[require.resolve("../../auth.ts")]={exports:{requireSession:async()=>({user:{id:"owner"}})}};
  const {scheduleMetricTasks}=require("../metric-scheduling.ts");
  const {writeMetricCheckpoint}=require("../metric-writer.ts");
  const {checkpointSchema}=require("../adapters/types.ts");
  const {claimTask,beginExecution,checkpointTask,taskResult}=require("../tasks.ts");
  const {lockOwner}=require("../../visibility/queries.ts");
  const {metricUnits}=require("../adapters/metric-contract.ts");
  const {estimate}=require("../budget.ts");
  const {collectInput}=require("../../consulting/input.ts");
  const {freezeSnapshot}=require("../../consulting/freeze.ts");
  const {reportDto}=require("../../consulting/data.ts");
  await client.setting.create({data:{ownerId:"owner",budgetMonthly:100000}});
  const domain=await client.domain.create({data:{ownerId:"owner",url:"metrics.example",market:"ko-KR"}});
  const foreignDomain=await client.domain.create({data:{ownerId:"foreign",url:"foreign.example"}});
  const foreignKey=await client.seoKeyword.create({data:{domainId:foreignDomain.id,keyword:"secret",normalizedKeyword:"secret",engine:"google"}});
  const config={host:"metrics.example",market:"ko-KR",scope:"research",engines:["google"],autoRankings:false,metricScheduling:"waiting"};
  const createdAt=new Date(Date.now()-3*86400000);
  const audit=await client.seoAudit.create({data:{domainId:domain.id,market:"ko-KR",scope:"research",runKey:"p1",configHash:"p1",frozenConfig:config,createdAt}});
  const keywords=[];
  for(let i=0;i<12;i++)keywords.push(await client.seoKeyword.create({data:{domainId:domain.id,keyword:`key${i}`,normalizedKeyword:`key${i}`,engine:"google",searchVolume:i,lastAuditId:audit.id}}));
  process.env.SEO_VERIFIED_PRICING_JSON=JSON.stringify(Object.fromEntries(["kw_difficulty","kw_demand","kw_ads"].map(op=>[op,{usdPerUnit:0.001,verifiedAt:new Date(Date.now()-1000).toISOString(),markets:["ko-KR"]}])));
  let tasks;
  await t.test("discovery schedules batches once; plan and claim retain exact reserve",async()=>{
   await Promise.all([scheduleMetricTasks("owner",audit.id),scheduleMetricTasks("owner",audit.id)]);
   tasks=await client.seoTask.findMany({where:{auditId:audit.id},orderBy:[{operation:"asc"},{itemKey:"asc"}]});
   assert.equal(tasks.length,6);
   for(const task of tasks)assert.equal(task.reservedKrw,estimate(task.operation,metricUnits(task.operation,task.frozenInput)));
   const candidate=tasks.find(t=>t.operation==="kw_ads");
   const claim=await claimTask("owner",candidate.id);assert.ok(claim);
   assert.equal((await client.seoTask.findUnique({where:{id:claim.id}})).reservedKrw,candidate.reservedKrw);
   await assert.rejects(scheduleMetricTasks("foreign",audit.id));
   // Complete an observed zero CPC/volume through real checkpoint and settlement.
   const cp=checkpointSchema.parse({observedAt:createdAt.toISOString(),adsMetrics:candidate.frozenInput.keywords.map(keyword=>({keyword,cpc:0,searchVolume:0,adCompetition:"LOW",currency:"USD",monthly:[{year:2026,month:9,volume:0}]}))});
   await beginExecution(claim);await checkpointTask(claim,"live-ads",5,cp);await checkpointTask(claim,"live-ads",5,cp);await taskResult(claim,cp);
   assert.equal(await client.costLedger.count({where:{ownerId:"owner",kind:"seo"}}),1);
   assert.equal((await client.seoKeyword.findUnique({where:{id:candidate.frozenInput.keywordIds[0]}})).adValue,0);
  });
  const demand=tasks.find(t=>t.operation==="kw_demand"), input=demand.frozenInput;
  const cp=checkpointSchema.parse({observedAt:createdAt.toISOString(),demandPoints:input.keywords.map(keyword=>({keyword,location:2410,year:input.targetPeriod.toYear,month:input.targetPeriod.toMonth,volume:0}))});
  async function write(task,result){return client.$transaction(async tx=>{await lockOwner(tx,"owner");await writeMetricCheckpoint(tx,task,result);});}
  await t.test("demand upsert is idempotent, delayed older results cannot overwrite newer, IDOR rejected",async()=>{
   await write(demand,cp);await write(demand,cp);
   assert.equal(await client.seoDemandPoint.count({where:{auditId:audit.id}}),input.keywords.length);
   const newerAudit=await client.seoAudit.create({data:{domainId:domain.id,market:"ko-KR",scope:"research",runKey:"newer",configHash:"newer",frozenConfig:{},createdAt:new Date(createdAt.getTime()+1000)}});
   const newerTask={...demand,id:"newer-task",auditId:newerAudit.id};
   await write(newerTask,{...cp,demandPoints:cp.demandPoints.map(p=>({...p,volume:7}))});
   await write(demand,cp);
   assert.equal((await client.seoDemandPoint.findFirst({where:{domainId:domain.id}})).volume,7);
   const bad={...demand,frozenInput:{...input,keywordIds:[foreignKey.id,...input.keywordIds.slice(1)]}};
   await assert.rejects(write(bad,cp));
   await assert.rejects(write(demand,{...cp,demandPoints:[{...cp.demandPoints[0],location:2840}]}));
   await assert.rejects(write(demand,{...cp,demandPoints:[cp.demandPoints[0],cp.demandPoints[0]]}));
   // Restore a matching stored checkpoint and point to make the report's provenance complete.
   await client.seoTask.create({data:{...newerTask,id:"newer-task",frozenInput:input,resultCheckpoint:{...cp,demandPoints:cp.demandPoints.map(p=>({...p,volume:7}))},status:"completed"}});
  });
  await t.test("v2 input/DTO are stored and remain immutable after recapture; detail never calls providers",async()=>{
   const snapshot=freezeSnapshot(await collectInput("owner",{id:domain.id,url:domain.url,market:"ko-KR"},null));
   assert.ok(snapshot.structuredMetrics.demand.length>0);
   const report=await client.consultingReport.create({data:{domainId:domain.id,ownerId:"owner",market:"ko-KR",inputSnapshotHash:"p1",inputSnapshot:snapshot,schemaVersion:"v2",promptVersion:"v2",model:"fixture",attemptId:"test"}});
   const before=JSON.stringify(reportDto(report));
   await client.seoDemandPoint.updateMany({where:{domainId:domain.id},data:{volume:999}});
   assert.equal(JSON.stringify(reportDto(await client.consultingReport.findUnique({where:{id:report.id}}))),before);
   assert.equal((await client.seoKeyword.findUnique({where:{id:"legacy-keyword"}})).competitionIndex,0.25);
  });
  await t.test("checkpoint-only recovery ignores price removal; live IDs never replay; parse failures retain charges",async()=>{
   const inputModule=require("../input.ts");
   require.cache[require.resolve("../input.ts")].exports={...inputModule,publicHost:async h=>h};
   const {executeTask}=require("../execute.ts");
   let calls=0;
   const checkpointTaskRow=tasks.find(t=>t.operation==="kw_difficulty");
   const difficultyCp=checkpointSchema.parse({difficulties:checkpointTaskRow.frozenInput.keywords.map(keyword=>({keyword,difficulty:0}))});
   await client.seoTask.update({where:{id:checkpointTaskRow.id},data:{resultCheckpoint:difficultyCp,status:"submitted",vendorTaskId:null}});
   process.env.SEO_VERIFIED_PRICING_JSON="{}";
   const recovered=checkpointTaskRow;
   const {resumeBatch}=require("../resume-batch.ts");
   const realFetch=global.fetch;
   global.fetch=async()=>{calls++;throw new Error("must not purchase");};
   try {await resumeBatch({limit:5,passes:5});}finally{global.fetch=realFetch;}
   assert.equal((await client.seoTask.findUnique({where:{id:recovered.id}})).status,"completed");
   const identityOnly=tasks.find(t=>t.operation==="kw_difficulty"&&t.id!==checkpointTaskRow.id);
   await client.seoTask.update({where:{id:identityOnly.id},data:{status:"submitted",vendorTaskId:"live-without-checkpoint"}});
   const uncertain=await claimTask("owner",identityOnly.id);
   await executeTask(uncertain,{post:async()=>{calls++;throw new Error("must not purchase");}});
   const uncertainRow=await client.seoTask.findUnique({where:{id:identityOnly.id}});
   assert.equal(uncertainRow.status,"uncertain");assert.ok(uncertainRow.reservedKrw>0);assert.equal(calls,0);
   process.env.SEO_VERIFIED_PRICING_JSON=JSON.stringify({kw_ads:{usdPerUnit:0.001,verifiedAt:new Date(Date.now()-1000).toISOString(),markets:["ko-KR"]}});
   const badAds=tasks.find(t=>t.operation==="kw_ads"&&t.itemKey.endsWith(":1"));
   const badClaim=await claimTask("owner",badAds.id);
   await executeTask(badClaim,{post:async(path,body,ctx)=>{
     calls++;
     const response={status_code:20000,tasks:[{id:"invalid-result",status_code:20000,result:[{keyword:badAds.frozenInput.keywords[0],cpc:2,search_volume:10,competition:"HIGH",currency:"KRW",
       monthly_searches:Array.from({length:49},(_,i)=>({year:2020+Math.floor(i/12),month:i%12+1,search_volume:1}))}]}]};
     await ctx.onTask("invalid-result",3,response);return response;
   }});
   const badRow=await client.seoTask.findUnique({where:{id:badAds.id}});
   assert.equal(badRow.status,"uncertain");assert.equal(badRow.costKrw,3);assert.ok(badRow.reservedKrw>0);
   assert.equal(await client.costLedger.count({where:{ownerId:"owner",kind:"seo"}}),2);
  });
  await t.test("cron finishes interrupted metric reservation scheduling without a paid call",async()=>{
   const pendingAudit=await client.seoAudit.create({data:{domainId:domain.id,market:"ko-KR",scope:"research",runKey:"schedule-crash",configHash:"test",frozenConfig:config}});
   const {resumeBatch}=require("../resume-batch.ts");
   const realFetch=global.fetch;let calls=0;
   global.fetch=async()=>{calls++;throw new Error("must not purchase");};
   try {await resumeBatch({limit:5,passes:5});}finally{global.fetch=realFetch;}
   const row=await client.seoAudit.findUnique({where:{id:pendingAudit.id}});
   assert.equal(row.frozenConfig.metricScheduling,"scheduled");
   assert.equal((await client.seoTask.findMany({where:{auditId:row.id}})).length,3);
   assert.equal(calls,0);
  });
  await t.test("cron expires inactive metric plans without buying; protected work retains holds", async () => {
   const old = new Date(Date.now()-2*86400000);
   const {resumeBatch}=require("../resume-batch.ts");
   for (const state of ["waiting", "scheduled"]) {
    const row=await client.seoAudit.create({data:{domainId:domain.id,market:"ko-KR",scope:"research",runKey:`expiry-${state}`,configHash:"expiry",
      frozenConfig:{...config,metricScheduling:state},createdAt:old}});
    await client.seoTask.createMany({data:[
      {auditId:row.id,ownerId:"owner",operation:"labs_ranked",itemKey:"base",runKey:row.runKey,frozenInput:{},status:"completed",createdAt:old,updatedAt:old},
      ...(state==="scheduled"?[{auditId:row.id,ownerId:"owner",operation:"kw_ads",itemKey:"pending",runKey:row.runKey,frozenInput:{},reservedKrw:12,createdAt:old,updatedAt:old}]:[]),
    ]});
    const originalFetch=global.fetch; let calls=0;
    global.fetch=async()=>{calls++;throw new Error("must not purchase");};
    try {await resumeBatch({limit:100,passes:5});}finally{global.fetch=originalFetch;}
    const saved=await client.seoAudit.findUnique({where:{id:row.id}});
    assert.equal(saved.frozenConfig.metricScheduling,"expired");assert.equal(saved.status,"partial");assert.ok(saved.completedAt);
    assert.equal((await client.seoTask.aggregate({where:{auditId:row.id},_sum:{reservedKrw:true}}))._sum.reservedKrw,0);
    await scheduleMetricTasks("owner",row.id);
    assert.equal(await client.seoTask.count({where:{auditId:row.id}}),state==="scheduled"?2:1);
    assert.equal(calls,0);
   }
   const {expireAbandonedAudit}=require("../reservations.ts");
   for(const guard of [{status:"submitted"},{status:"uncertain",updatedAt:new Date()},{status:"claimed",leaseUntil:new Date(Date.now()+60000)},
     {vendorTaskId:"protected-live"},{costKrw:2},{resultCheckpoint:cp},{updatedAt:new Date()}]) {
    const row=await client.seoAudit.create({data:{domainId:domain.id,market:"ko-KR",scope:"research",runKey:crypto.randomUUID(),configHash:"protected",
      frozenConfig:{...config,metricScheduling:"scheduled"},createdAt:old}});
    const pending=await client.seoTask.create({data:{auditId:row.id,ownerId:"owner",operation:"kw_ads",itemKey:"pending",runKey:row.runKey,
      frozenInput:{},reservedKrw:12,createdAt:old,updatedAt:old,...guard}});
    await client.$transaction(async tx=>{await lockOwner(tx,"owner");await expireAbandonedAudit(tx,"owner",domain.id,row.id);});
    assert.equal((await client.seoAudit.findUnique({where:{id:row.id}})).status,"pending");
    assert.equal((await client.seoTask.findUnique({where:{id:pending.id}})).reservedKrw,12);
   }
  });
  await t.test("stale uncertain charges do not strand pending reservations in cron",async()=>{
   const {resumeBatch}=require("../resume-batch.ts");
   const old=new Date(Date.now()-2*86400000);
   for(const completed of [false,true]) {
    const row=await client.seoAudit.create({data:{domainId:domain.id,market:"ko-KR",scope:"research",runKey:crypto.randomUUID(),configHash:"uncertain-expiry",
      frozenConfig:{...config,metricScheduling:"scheduled"},createdAt:old}});
    const uncertain=await client.seoTask.create({data:{auditId:row.id,ownerId:"owner",operation:"kw_ads",itemKey:"uncertain",runKey:row.runKey,
      frozenInput:{},status:"uncertain",costKrw:3,reservedKrw:12,createdAt:old,updatedAt:old}});
    const pending=await client.seoTask.create({data:{auditId:row.id,ownerId:"owner",operation:"kw_demand",itemKey:"pending",runKey:row.runKey,
      frozenInput:{},reservedKrw:12,createdAt:old,updatedAt:old}});
    if(completed) await client.seoTask.create({data:{auditId:row.id,ownerId:"owner",operation:"labs_ranked",itemKey:"done",runKey:row.runKey,
      frozenInput:{},status:"completed",createdAt:old,updatedAt:old}});
    const ledger=await client.costLedger.findMany({where:{ownerId:"owner",kind:"seo"},orderBy:{id:"asc"}});
    const originalFetch=global.fetch;let calls=0;
    global.fetch=async()=>{calls++;throw new Error("must not purchase");};
    try {await resumeBatch({limit:100,passes:5});}finally{global.fetch=originalFetch;}
    assert.equal((await client.seoAudit.findUnique({where:{id:row.id}})).status,completed?"partial":"failed");
    const held=await client.seoTask.findUnique({where:{id:uncertain.id}});
    assert.equal(held.status,"uncertain");assert.equal(held.costKrw,3);assert.equal(held.reservedKrw,12);
    const released=await client.seoTask.findUnique({where:{id:pending.id}});
    assert.equal(released.status,"failed");assert.equal(released.reservedKrw,0);
    assert.deepEqual(await client.costLedger.findMany({where:{ownerId:"owner",kind:"seo"},orderBy:{id:"asc"}}),ledger);
    assert.equal(calls,0);
   }
  });
  await t.test("latest per keyword prevents metric and ranking starvation before limits",async()=>{
   const {readStructuredInput}=require("../../consulting/structured-input.ts");
   const d=await client.domain.create({data:{ownerId:"owner",url:"starvation.example",market:"ko-KR"}});
   try {
    const at=new Date(Date.now()-1000);
    const a=await client.seoAudit.create({data:{domainId:d.id,market:"ko-KR",scope:"research",runKey:"starvation",configHash:"starvation",frozenConfig:{},createdAt:at}});
    const keys=[];
    for(const keyword of ["busy","scarce"]) keys.push(await client.seoKeyword.create({data:{domainId:d.id,keyword,normalizedKeyword:keyword,engine:"google"}}));
    await client.seoTask.createMany({data:Array.from({length:152},(_,i)=>{
     const k=keys[i===151?1:0];
     return {id:`starvation-${String(i).padStart(3,"0")}`,auditId:a.id,ownerId:"owner",operation:"kw_difficulty",itemKey:String(i),runKey:a.runKey,status:"completed",
      frozenInput:{location:2410,market:"ko-KR",keywordIds:[k.id],keywords:[k.keyword]},
      resultCheckpoint:checkpointSchema.parse({observedAt:at.toISOString(),difficulties:[{keyword:k.keyword,difficulty:i===151?30:i===0?10:20}]})};
    })});
    await client.seoRanking.createMany({data:Array.from({length:502},(_,i)=>({domainId:d.id,auditId:a.id,keywordId:keys[i===501?1:0].id,
      market:"ko-KR",engine:"google",source:"serp",device:`device${i}`,status:"ranked",rank:i===501?7:2,capturedAt:new Date(at.getTime()-i*1000)}))});
    const snapshot={market:"ko-KR",range:{to:new Date().toISOString()},selection:[],evidence:[],limitations:[]};
    const result=await client.$transaction(tx=>readStructuredInput(tx,"owner",d.id,snapshot));
    assert.equal(result.keywords.find(k=>k.keyword==="busy").difficulty,10);
    const scarce=result.keywords.find(k=>k.keyword==="scarce");
    assert.equal(scarce.difficulty,30);assert.equal(scarce.rank,7);assert.equal(scarce.status,"partial");
   } finally {await client.domain.delete({where:{id:d.id}});}
  });
  await t.test("monthly demand batches retain all twelve months beyond the former task limit",async()=>{
   const {readStructuredInput}=require("../../consulting/structured-input.ts");
   const d=await client.domain.create({data:{ownerId:"owner",url:"monthly-demand.example",market:"ko-KR"}});
   try {
    const to=new Date("2026-10-20T00:00:00.000Z"), at=new Date("2026-10-01T00:00:00.000Z");
    const a=await client.seoAudit.create({data:{domainId:d.id,market:"ko-KR",scope:"research",runKey:"monthly",configHash:"monthly",frozenConfig:{},createdAt:at}});
    const keys=[];
    for(let i=0;i<13;i++)keys.push(await client.seoKeyword.create({data:{domainId:d.id,keyword:`monthly${i}`,normalizedKeyword:`monthly${i}`,engine:"google"}}));
    for(const k of keys)for(let i=0;i<12;i++) {
     const month=new Date(Date.UTC(2025,9+i,1));
     const year=month.getUTCFullYear(), m=month.getUTCMonth()+1;
     await client.seoTask.create({data:{auditId:a.id,ownerId:"owner",operation:"kw_demand",itemKey:`${k.id}:${i}`,runKey:a.runKey,
      status:i%2?"completed":"partial",
      frozenInput:{location:2410,market:"ko-KR",keywordIds:[k.id],keywords:[k.keyword],targetPeriod:{fromYear:year,fromMonth:m,toYear:year,toMonth:m}},
      resultCheckpoint:checkpointSchema.parse({observedAt:at.toISOString(),demandPoints:[{keyword:k.keyword,location:2410,year,month:m,volume:i}]})}});
     await client.seoDemandPoint.create({data:{domainId:d.id,keywordId:k.id,auditId:a.id,market:"ko-KR",location:2410,year,month:m,volume:i}});
    }
    const snapshot={market:"ko-KR",range:{to:to.toISOString()},selection:[],evidence:[],limitations:[]};
    const result=await client.$transaction(tx=>readStructuredInput(tx,"owner",d.id,snapshot));
    assert.equal(result.demand.length,156);
    for(const k of keys)assert.equal(result.demand.filter(p=>p.keywordId===k.id).length,12);
    assert.deepEqual(snapshot.limitations,[]);
   } finally {await client.domain.delete({where:{id:d.id}});}
  });
  await t.test("FK uniqueness and cascade protect stored demand lifecycle",async()=>{
   const point=await client.seoDemandPoint.findFirst({where:{domainId:domain.id}});
   await assert.rejects(client.seoDemandPoint.create({data:{...point,id:"duplicate"}}));
   await assert.rejects(client.seoDemandPoint.create({data:{...point,id:"bad-fk",keywordId:"absent"}}));
   await client.domain.delete({where:{id:domain.id}});
   assert.equal(await client.seoDemandPoint.count({where:{domainId:domain.id}}),0);
   assert.equal(await client.costLedger.count({where:{ownerId:"owner",kind:"seo"}}),2);
  });
 } finally {
  if(oldPrices===undefined)delete process.env.SEO_VERIFIED_PRICING_JSON;else process.env.SEO_VERIFIED_PRICING_JSON=oldPrices;
  if(client)await client.$disconnect();if(server)await server.stop();await db.close();
 }
});
