/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, __dirname, process, setTimeout, Request */
require("../../visibility/__tests__/register.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createRequire } = require("node:module");
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;
test("isolated PostgreSQL: consulting migration, actual API/service, concurrency and accounting", { skip: !packageDir && "Set PGLITE_SOCKET_PACKAGE for isolated PostgreSQL" }, async t => {
  const runtime = createRequire(path.join(packageDir,"package.json"));
  const { PGlite } = runtime("@electric-sql/pglite");
  const { PGLiteSocketServer } = runtime("@electric-sql/pglite-socket");
  const { PrismaClient } = require("@prisma/client");
  const db = await PGlite.create();
  let client, server, calls = 0, mode = "valid", session;
  const queries = [];
  const owner = "clx12345678901234567890123", foreign = "clx12345678901234567890124";
  const root = path.resolve(__dirname,"../../..");
  try {
    const ddl = execFileSync(path.join(root,"node_modules/.bin/prisma"), ["migrate","diff","--from-empty","--to-schema-datamodel",path.join(root,"prisma/schema.prisma"),"--script"], {encoding:"utf8"})
      .replace(/CREATE EXTENSION[^;]*;/g,"").replace(/vector\(1536\)/g,"TEXT");
    const baseline = ddl.split(";").filter(s => !/(?:CREATE TABLE|CREATE (?:UNIQUE )?INDEX|ALTER TABLE) "consulting_reports(?:"|_)/.test(s)).join(";");
    await db.exec(baseline);
    await db.exec(`INSERT INTO users(id,email,password_hash,updated_at,plan) VALUES ('${owner}','consulting@example.test','unused',now(),'starter'),('${foreign}','foreign@example.test','unused',now(),'pro')`);
    const sql = fs.readFileSync(path.join(root,"prisma/manual-migrations/20261020_minteq_consulting.sql"),"utf8");
    await t.test("additive migration applies twice and preserves existing rows", async () => {
      await db.exec(sql); await db.exec(sql);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM users")).rows[0].n,2);
    });
    await t.test("migration rejects incompatible pre-existing columns, indexes and foreign keys", async () => {
      for (const change of [
        'ALTER TABLE consulting_reports ALTER COLUMN reserved_krw TYPE INTEGER',
        'DROP INDEX consulting_reports_owner_id_created_at_id_idx; CREATE INDEX consulting_reports_owner_id_created_at_id_idx ON consulting_reports(domain_id)',
        'ALTER TABLE consulting_reports DROP CONSTRAINT consulting_reports_domain_id_fkey; ALTER TABLE consulting_reports ADD CONSTRAINT consulting_reports_domain_id_fkey FOREIGN KEY (domain_id) REFERENCES domains(id)',
      ]) {
        await db.exec('BEGIN; '+change+';');
        await assert.rejects(db.exec(sql));
        await db.exec('ROLLBACK');
      }
    });
    server = new PGLiteSocketServer({ db, port:0, host:"127.0.0.1" }); await server.start();
    const connection = server.getServerConn();
    const address = connection.startsWith("postgres") ? connection : `postgresql://postgres:postgres@${connection}/postgres`;
    client = new PrismaClient({ log:[{emit:"event",level:"query"}], datasources:{db:{url:address+(address.includes("?")?"&":"?")+"connection_limit=1&sslmode=disable"}} });
    client.$on("query",event=>queries.push(event.query));
    require.cache[require.resolve("../../prisma.ts")] = {exports:{prisma:client}};
    require.cache[require.resolve("../../auth.ts")] = {exports:{requireSession:async()=>{if(!session)throw new Error("Unauthorized");return {user:{id:session}};}}};
    const realChat = require("../../claude/chat.ts");
    const { strategy } = require("./fixtures.cjs");
    require.cache[require.resolve("../../claude/chat.ts")].exports = {...realChat, getClient:()=>({chat:{completions:{create:async (request, options)=>{
      calls++; assert.equal(options.maxRetries,0); assert.equal(options.timeout,60000);
      assert.equal(request.model,"gpt-4o"); assert.equal(request.tool_choice.function.name,"submit_strategy");
      await new Promise(resolve=>setTimeout(resolve,15));
      if(mode==="timeout")throw new Error("timeout");
      if(mode==="auth_rejected") { const { APIError }=require("openai"); throw new APIError(401,{},"invalid key",new Headers()); }
      const input = JSON.parse(request.messages[1].content).untrustedStoredEvidence;
      const value = strategy();
      value.diagnosis.summary="현재 점수 {{ev:seo_tech_score}}";
      for(const x of [...value.channelMix,...value.priorityActions])x.evidenceIds=["seo_tech_score"];
      value.budgetProposal.totalAmount=input.monthlyMarketingBudget?.amount??null;
      value.budgetProposal.currency=input.monthlyMarketingBudget?.currency??"KRW";
      if(mode==="bad_evidence") value.diagnosis.summary="{{ev:unknown}}";
      if(mode==="numeric") value.diagnosis.summary="수익 100%";
      // 강제 tool_choice에서 OpenAI는 finish_reason "stop"을 반환한다(실동작). "tool_calls" 목은 비현실적이었음.
      const response={usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150},choices:[{finish_reason:"stop",message:{tool_calls:[{type:"function",function:{name:"submit_strategy",arguments:JSON.stringify(value)}}]}}]};
      if(mode==="no_usage") delete response.usage;
      if(mode==="no_tool") response.choices[0].message.tool_calls=[];
      if(mode==="json") response.choices[0].message.tool_calls[0].function.arguments="{";
      if(mode==="truncated")response.choices[0].finish_reason="length";
      return response;
    }}}})};
    const { generateReport } = require("../generate.ts");
    const { collectInput } = require("../input.ts");
    const { getReports } = require("../data.ts");
    const { deleteDomain } = require("../../visibility/domains.ts");
    const route = require("../../../app/api/consulting/route.ts");
    await client.setting.create({data:{ownerId:owner,budgetMonthly:100000}});
    const domain=await client.domain.create({data:{ownerId:owner,url:"owned.example",market:"ko-KR"}});
    const other=await client.domain.create({data:{ownerId:owner,url:"other.example"}});
    await t.test("whole missing data and IDOR reject before LLM or ledger",async()=>{
      await assert.rejects(generateReport(owner,{domainId:domain.id}),e=>e.code==="data_required");
      await assert.rejects(generateReport(foreign,{domainId:domain.id}),e=>e.status===404);
      assert.equal(calls,0); assert.equal(await client.costLedger.count(),0);
    });
    const observed=new Date(Date.now()-86400000);
    await client.seoAudit.create({data:{domainId:domain.id,market:"ko-KR",scope:"full",status:"completed",technicalScore:65,coverage:0.4,checks:[],runKey:"consulting",configHash:"test",frozenConfig:{},createdAt:observed,completedAt:observed}});
    await t.test("input uses stored data only and keeps partial coverage, GEO null and GA4 missing",async()=>{
      const s=await collectInput(owner,domain,null);
      assert.equal(s.sourceStatus.find(x=>x.source==="seo").status,"partial");
      assert.equal(s.evidence.find(x=>x.id==="seo_coverage").value,0.4);
      assert.equal(s.evidence.find(x=>x.id==="geo_chatgpt_sov")?.value,null,JSON.stringify(s.sourceStatus));
      assert.equal(s.sourceStatus.find(x=>x.source==="ga4").status,"missing",JSON.stringify(s.sourceStatus));
      assert.equal(JSON.stringify(s).includes("frozenConfig"),false);
    });
    await t.test("source query errors remain error, and GA4 default zeros never become observations",async()=>{
      await client.analyticsDaily.create({data:{ownerId:owner,date:observed.toISOString().slice(0,10),channel:"blog",source:"ga4"}});
      let snap=await collectInput(owner,domain,null);
      assert.equal(snap.sourceStatus.find(x=>x.source==="ga4").status,"unmapped");
      assert.equal(snap.evidence.some(x=>x.source==="ga4"),false);
      await client.$executeRawUnsafe('ALTER TABLE analytics_daily RENAME TO analytics_daily_offline');
      try {
        snap=await collectInput(owner,domain,null);
        assert.equal(snap.sourceStatus.find(x=>x.source==="ga4").status,"error");
        assert.equal(snap.sourceStatus.find(x=>x.source==="seo").status,"partial");
      } finally { await client.$executeRawUnsafe('ALTER TABLE analytics_daily_offline RENAME TO analytics_daily'); }
      await client.analyticsDaily.deleteMany();
    });
    await t.test("GEO valid denominators exclude failed/unresolved samples and zero is a genuine observation",async()=>{
      const q=await client.visibilityQuery.create({data:{ownerId:owner,domainId:domain.id,query:"stored",engines:["gemini"],brandAliases:["brand"],competitorAliases:[]}});
      const stored=await client.visibilitySnapshot.create({data:{queryId:q.id,engine:"gemini",capturedAt:observed,status:"ok",mentions:{create:[{subject:"brand",label:"brand",mentioned:false,cited:false},{subject:"domain",label:domain.url,mentioned:false,cited:false}]}}});
      await client.visibilitySnapshot.create({data:{queryId:q.id,engine:"gemini",capturedAt:observed,status:"failed"}});
      let snap=await collectInput(owner,domain,null);
      assert.equal(snap.evidence.find(x=>x.id==="geo_gemini_sov").value,0);
      assert.equal(snap.evidence.find(x=>x.id==="geo_gemini_validSamples").value,1);
      assert.equal(snap.evidence.find(x=>x.id==="geo_gemini_failedCount").value,1);
      await client.visibilityMention.updateMany({where:{snapshotId:stored.id},data:{resolvable:false}});
      snap=await collectInput(owner,domain,null);
      assert.equal(snap.evidence.find(x=>x.id==="geo_gemini_sov").value,null);
      assert.equal(snap.sourceStatus.find(x=>x.source==="geo").status,"missing");
      await client.visibilityQuery.delete({where:{id:q.id}});
    });
    const input={domainId:domain.id,monthlyMarketingBudget:{amount:101,currency:"KRW"}};
    let report;
    await t.test("SQL failures in multiple sources restart the snapshot and preserve successful GEO observations",async()=>{
      const before=calls;
      await client.$executeRawUnsafe('ALTER TABLE seo_keywords RENAME TO seo_keywords_offline');
      await client.$executeRawUnsafe('ALTER TABLE analytics_daily RENAME TO analytics_daily_offline');
      try {
        const snap=await collectInput(owner,domain,null);
        assert.equal(snap.sourceStatus.find(x=>x.source==="seo").status,"error");
        assert.equal(snap.sourceStatus.find(x=>x.source==="ga4").status,"error");
        assert.equal(snap.evidence.some(x=>x.source==="seo"),false);
        assert.ok(snap.evidence.some(x=>x.source==="geo"));
        assert.equal(snap.sourceStatus.length,3);
        assert.equal(calls,before);
      } finally {
        await client.$executeRawUnsafe('ALTER TABLE seo_keywords_offline RENAME TO seo_keywords');
        await client.$executeRawUnsafe('ALTER TABLE analytics_daily_offline RENAME TO analytics_daily');
      }
    });
    await t.test("concurrent same input calls LLM once; completed replay and GET are free",async()=>{
      const results=await Promise.allSettled([generateReport(owner,input),generateReport(owner,input)]);
      report=results.find(x=>x.status==="fulfilled").value.data;
      const rejected=results.find(x=>x.status==="rejected");
      if(rejected)assert.equal(rejected.reason.code,"generation_in_progress");
      assert.equal(calls,1); assert.equal(await client.costLedger.count(),1);
      const reused=await generateReport(owner,input); assert.equal(reused.reused,true); assert.equal(calls,1);
      assert.equal(reused.data.status,"completed");
      const ledger=await client.costLedger.findFirst(); assert.equal(ledger.kind,"consulting"); assert.equal(ledger.contentId,null);
      const row=await client.consultingReport.findUnique({where:{id:report.id}}); assert.equal(row.reservedKrw,0);assert.ok(row.ledgerId);
      assert.equal((await getReports(owner,{domainId:domain.id,reportId:report.id,limit:20})).id,report.id);
      for(const [who,domainId] of [[foreign,domain.id],[owner,other.id]]) await assert.rejects(getReports(who,{domainId,reportId:report.id,limit:20}),e=>e.status===404);
      const dto=JSON.stringify(report);for(const key of ["inputSnapshot","ownerId","attemptId","ledgerId","costKrw","reservedKrw"])assert.equal(dto.includes('"'+key+'"'),false,key);
    });
    await t.test("real API returns reportId with in-progress errors and history with cursor pagination",async()=>{
      session=owner;
      const row=await client.consultingReport.findUnique({where:{id:report.id}});
      await client.consultingReport.update({where:{id:row.id},data:{status:"generating"}});
      const res=await route.POST(new Request("https://app.test/api/consulting",{method:"POST",body:JSON.stringify(input)}));
      assert.equal(res.status,409);assert.equal((await res.json()).error.reportId,row.id);
      await client.consultingReport.update({where:{id:row.id},data:{status:"completed"}});
      const before=calls;
      const response=await route.GET(new Request(`https://app.test/api/consulting?domainId=${domain.id}`));assert.equal(response.status,200);assert.equal(calls,before);
    });
    await t.test("history selects bounded summary columns and never parses or returns snapshot/strategy",async()=>{
      const row=await client.consultingReport.findUnique({where:{id:report.id}});
      // Corrupt detail-only JSON deliberately: history must remain independently readable.
      await client.consultingReport.update({where:{id:row.id},data:{inputSnapshot:{invalid:true},strategyJson:{invalid:true}}});
      try {
        const before=calls;
        queries.length=0;
        const history=await getReports(owner,{domainId:domain.id,limit:100});
        const sql=queries.find(q=>q.includes('"consulting_reports"')&&q.includes("ORDER BY"));
        assert.ok(sql);assert.equal(sql.includes('"input_snapshot"'),false);assert.equal(sql.includes('"strategy_json"'),false);
        const summary=history.items.find(x=>x.id===report.id);
        assert.equal(summary.diagnosisSummary,row.diagnosisSummary);
        assert.equal(summary.budgetProposal.totalAmount,101);
        for(const key of ["inputSnapshot","strategyJson","evidence","sourceStatus","limitations","range","diagnosis","channelMix","priorityActions","ownerId","attemptId"])
          assert.equal(Object.hasOwn(summary,key),false,key);
        assert.equal(calls,before);
        await assert.rejects(getReports(owner,{domainId:domain.id,reportId:row.id,limit:20}));
      } finally {
        await client.consultingReport.update({where:{id:row.id},data:{inputSnapshot:row.inputSnapshot,strategyJson:row.strategyJson}});
      }
      assert.ok((await getReports(owner,{domainId:domain.id,reportId:row.id,limit:20})).evidence.length);
      assert.deepEqual(await getReports(owner,{domainId:other.id,limit:100}),{items:[],nextCursor:null});
    });
    await t.test("stale leases recover once, preserve uncertain reserves, and allow late idempotent settlement",async()=>{
      const { GENERATION_LEASE_MS }=require("../lifecycle.ts");
      const { beginAttempt, findExisting }=require("../data.ts");
      const { markUncertain, settleReport }=require("../budget.ts");
      const original=await client.consultingReport.findUnique({where:{id:report.id}});
      const base={...original};delete base.id;
      const old=new Date(Date.now()-GENERATION_LEASE_MS-60000);
      const make=(hash,overrides={})=>client.consultingReport.create({data:{...base,
        inputSnapshotHash:hash,attemptId:hash,status:"generating",ledgerId:null,costKrw:0,reservedKrw:100,
        startedAt:old,createdAt:old,generatedAt:null,strategyJson:undefined,budgetProposal:undefined,
        ...overrides}});
      const started=await make("stale-started");
      const unstarted=await make("stale-unstarted",{startedAt:null});
      const active=await make("active",{startedAt:new Date()}); // old creation, recent start
      const fresh=await make("fresh-unstarted",{startedAt:null,createdAt:new Date()});
      const foreignDomain=await client.domain.create({data:{ownerId:foreign,url:"foreign.example"}});
      const foreignRow=await make("foreign-stale",{ownerId:foreign,domainId:foreignDomain.id});
      const ids=[started.id,unstarted.id,active.id,fresh.id,foreignRow.id];
      try {
        const before=calls;
        await getReports(owner,{domainId:domain.id,limit:100});
        const read=id=>client.consultingReport.findUnique({where:{id}});
        const uncertain=await read(started.id), failed=await read(unstarted.id);
        assert.equal(uncertain.status,"uncertain");assert.equal(uncertain.reservedKrw,100);assert.equal(uncertain.ledgerId,null);
        assert.equal(failed.status,"failed");assert.equal(failed.reservedKrw,0);
        for(const row of [active,fresh,foreignRow])assert.equal((await read(row.id)).status,"generating");
        const { reserveBudget }=require("../budget.ts");
        const { lockOwner }=require("../../visibility/queries.ts");
        const previousLimit=process.env.CONSULTING_GENERATION_LIMIT, previousWindow=process.env.CONSULTING_GENERATION_WINDOW_SECONDS;
        try {
          // Only durable reservations within the configured window count, regardless of report state.
          const recent=await client.auditLog.count({where:{actor:owner,action:"consulting.reserve",createdAt:{gte:new Date(Date.now()-3600000)}}});
          process.env.CONSULTING_GENERATION_LIMIT=String(recent+1);process.env.CONSULTING_GENERATION_WINDOW_SECONDS="3600";
          await client.$transaction(async tx=>{const plan=await lockOwner(tx,owner);await reserveBudget(tx,owner,plan,1);});
        } finally {
          if(previousLimit===undefined)delete process.env.CONSULTING_GENERATION_LIMIT;else process.env.CONSULTING_GENERATION_LIMIT=previousLimit;
          if(previousWindow===undefined)delete process.env.CONSULTING_GENERATION_WINDOW_SECONDS;else process.env.CONSULTING_GENERATION_WINDOW_SECONDS=previousWindow;
        }
        await assert.rejects(beginAttempt(owner,unstarted.id,unstarted.attemptId),e=>e.code==="generation_uncertain");
        await markUncertain(owner,unstarted.id,unstarted.attemptId);
        assert.equal((await read(unstarted.id)).status,"failed");
        assert.equal((await findExisting(owner,domain.id,"stale-started")).status,"uncertain");
        await getReports(owner,{domainId:domain.id,limit:100});
        for(const [targetId,action] of [[started.id,"consulting.stale_uncertain"],[unstarted.id,"consulting.expired_unstarted"]])
          assert.equal(await client.auditLog.count({where:{targetId,action}}),1);
        const usage={prompt_tokens:100,completion_tokens:50,total_tokens:150};
        const saved=await settleReport(owner,started.id,started.attemptId,usage,1,original.strategyJson);
        assert.equal(saved.status,"completed");assert.equal(saved.reservedKrw,0);
        const duplicate=await settleReport(owner,started.id,started.attemptId,usage,1,original.strategyJson);
        assert.equal(duplicate.ledgerId,saved.ledgerId);
        await markUncertain(owner,started.id,started.attemptId);
        assert.equal((await read(started.id)).status,"completed");
        await assert.rejects(settleReport(owner,unstarted.id,unstarted.attemptId,usage,1,null));
        assert.equal(calls,before);
      } finally {
        await client.consultingReport.deleteMany({where:{id:{in:ids}}});
        await client.domain.delete({where:{id:foreignDomain.id}});
      }
    });
    await t.test("lease boundary expires unstarted work, but an intervening atomic start wins safely",async()=>{
      const { GENERATION_LEASE_MS, expireStaleReports }=require("../lifecycle.ts");
      const { lockOwner }=require("../../visibility/queries.ts");
      const base={...await client.consultingReport.findUnique({where:{id:report.id}})};delete base.id;
      const now=new Date(), cutoff=new Date(now.getTime()-GENERATION_LEASE_MS);
      const row=await client.consultingReport.create({data:{...base,inputSnapshotHash:"lease-boundary",attemptId:"lease-boundary",
        status:"generating",ledgerId:null,reservedKrw:100,startedAt:null,createdAt:cutoff}});
      try {
        await client.$transaction(async tx=>{await lockOwner(tx,owner);await expireStaleReports(tx,owner,now);});
        assert.equal((await client.consultingReport.findUnique({where:{id:row.id}})).status,"failed");
        await client.consultingReport.update({where:{id:row.id},data:{status:"generating",failCode:null,reservedKrw:100}});
        await client.$transaction(async tx=>{
          await lockOwner(tx,owner);
          // Deterministically interleave beginAttempt's write between sweep selection and expiry.
          const interleaved={...tx,consultingReport:{...tx.consultingReport,findMany:async args=>{
            const selected=await tx.consultingReport.findMany(args);
            await tx.consultingReport.update({where:{id:row.id},data:{startedAt:now}});
            return selected;
          }}};
          await expireStaleReports(interleaved,owner,now);
        });
        const active=await client.consultingReport.findUnique({where:{id:row.id}});
        assert.equal(active.status,"generating");assert.equal(active.reservedKrw,100);
        assert.equal(await client.auditLog.count({where:{targetId:row.id,action:"consulting.expired_unstarted"}}),1);
      } finally { await client.consultingReport.delete({where:{id:row.id}}); }
    });
    await t.test("reservation path commits stale recovery even when the new reservation is denied",async()=>{
      const { GENERATION_LEASE_MS }=require("../lifecycle.ts");
      const original=await client.consultingReport.findUnique({where:{id:report.id}});
      const base={...original};delete base.id;
      const stale=await client.consultingReport.create({data:{...base,inputSnapshotHash:"stale-denied",attemptId:"stale-denied",
        status:"generating",ledgerId:null,reservedKrw:100,startedAt:new Date(Date.now()-GENERATION_LEASE_MS-60000)}});
      const before=calls;
      try {
        await client.setting.update({where:{ownerId:owner},data:{budgetMonthly:0}});
        await assert.rejects(generateReport(owner,{...input,monthlyMarketingBudget:{amount:901,currency:"KRW"}}),e=>e.code==="rate_limited");
        const recovered=await client.consultingReport.findUnique({where:{id:stale.id}});
        assert.equal(recovered.status,"uncertain");assert.equal(recovered.reservedKrw,100);
        assert.equal(calls,before);
      } finally {
        await client.consultingReport.delete({where:{id:stale.id}});
        await client.setting.update({where:{ownerId:owner},data:{budgetMonthly:100000}});
      }
    });
    await t.test("unstarted expiry atomically re-reserves a fresh attempt and concurrent retries call LLM once",async()=>{
      const { claimReport, beginAttempt }=require("../data.ts");
      const { VERSIONS, RESERVE_KRW }=require("../prompt.ts");
      const { freezeSnapshot }=require("../freeze.ts");
      const { snapshotHash }=require("../hash.ts");
      const request={...input,monthlyMarketingBudget:{amount:902,currency:"KRW"}};
      const snapshot=freezeSnapshot(await collectInput(owner,domain,request.monthlyMarketingBudget));
      const hash=snapshotHash({snapshot,...VERSIONS});
      const claim=await claimReport(owner,domain.id,snapshot,hash,VERSIONS,"old-unstarted",RESERVE_KRW);
      await client.consultingReport.update({where:{id:claim.row.id},data:{createdAt:new Date(Date.now()-600000)}});
      const before=calls;
      const attempts=await Promise.allSettled([generateReport(owner,request),generateReport(owner,request)]);
      assert.ok(attempts.some(x=>x.status==="fulfilled"));assert.equal(calls,before+1);
      const row=await client.consultingReport.findUnique({where:{id:claim.row.id}});
      assert.equal(row.status,"completed");assert.notEqual(row.attemptId,"old-unstarted");assert.equal(row.reservedKrw,0);
      await assert.rejects(beginAttempt(owner,row.id,"old-unstarted"));
      const again=await generateReport(owner,request);assert.equal(again.reused,true);assert.equal(calls,before+1);
      assert.equal(await client.auditLog.count({where:{targetId:row.id,action:"consulting.reserve"}}),2);
    });
    await t.test("authentication rejection releases shared budget and allows exactly one fresh retry",async()=>{
      const request={...input,monthlyMarketingBudget:{amount:903,currency:"KRW"}};
      const before=calls, ledger=await client.costLedger.count();mode="auth_rejected";
      let reportId;
      await assert.rejects(generateReport(owner,request),e=>{reportId=e.reportId;return e.code==="llm_failed";});
      const row=await client.consultingReport.findUnique({where:{id:reportId}});
      assert.equal(row.status,"failed");assert.equal(row.failCode,"request_rejected");assert.equal(row.reservedKrw,0);
      assert.equal(await client.costLedger.count(),ledger);
      mode="valid";
      const attempts=await Promise.allSettled([generateReport(owner,request),generateReport(owner,request)]);
      assert.ok(attempts.some(x=>x.status==="fulfilled"));assert.equal(calls,before+2);
      assert.equal(await client.costLedger.count(),ledger+1);
    });
    await t.test("failed and deleted reports cannot reset the durable generation window",async()=>{
      const { claimReport, beginAttempt }=require("../data.ts");
      const { markRejected, reserveBudget }=require("../budget.ts");
      const { VERSIONS }=require("../prompt.ts");
      const { lockOwner }=require("../../visibility/queries.ts");
      const doomed=await client.domain.create({data:{ownerId:owner,url:"doomed.example"}});
      const snapshot=await collectInput(owner,domain,null);
      const claim=await claimReport(owner,doomed.id,snapshot,"doomed",VERSIONS,"doomed-attempt",1);
      await beginAttempt(owner,claim.row.id,"doomed-attempt");
      await markRejected(owner,claim.row.id,"doomed-attempt");
      const n=await client.auditLog.count({where:{actor:owner,action:"consulting.reserve",createdAt:{gte:new Date(Date.now()-3600000)}}});
      process.env.CONSULTING_GENERATION_LIMIT=String(n);process.env.CONSULTING_GENERATION_WINDOW_SECONDS="3600";
      try {
        const reserve=()=>client.$transaction(async tx=>{const plan=await lockOwner(tx,owner);await reserveBudget(tx,owner,plan,1);});
        await assert.rejects(reserve(),e=>e.code==="rate_limited");
        await deleteDomain(owner,doomed.id);
        assert.equal(await client.consultingReport.count({where:{id:claim.row.id}}),0);
        await assert.rejects(reserve(),e=>e.code==="rate_limited");
        assert.equal(await client.auditLog.count({where:{targetId:claim.row.id,action:"consulting.reserve"}}),1);
      } finally {delete process.env.CONSULTING_GENERATION_LIMIT;delete process.env.CONSULTING_GENERATION_WINDOW_SECONDS;}
    });
    await t.test("domain search and scoped cursor reach beyond one hundred domains; direct links enforce ownership",async()=>{
      const {consultingDomains,consultingDomainQuerySchema:parse}=require("../domains.ts");
      const date=new Date("2025-01-01T00:00:00Z");
      await client.domain.createMany({data:Array.from({length:105},(_,i)=>({ownerId:owner,url:`bulk-${String(i).padStart(3,"0")}.example`,createdAt:date}))});
      const first=await consultingDomains(owner,parse.parse({q:"bulk-",limit:100}));
      assert.equal(first.items.length,100);assert.ok(first.nextCursor);
      const second=await consultingDomains(owner,parse.parse({q:"bulk-",limit:100,cursor:first.nextCursor}));
      assert.equal(second.items.length,5);assert.equal(second.nextCursor,null);
      assert.equal(new Set([...first.items,...second.items].map(d=>d.id)).size,105);
      const target=second.items[4];
      assert.equal((await consultingDomains(owner,parse.parse({domainId:target.id}))).items[0].id,target.id);
      assert.equal((await consultingDomains(owner,parse.parse({q:target.url.toUpperCase()}))).items.length,1);
      await assert.rejects(consultingDomains(foreign,parse.parse({domainId:target.id})),e=>e.status===404);
      await assert.rejects(consultingDomains(foreign,parse.parse({q:"bulk-",cursor:first.nextCursor})),e=>e.status===400);
      await assert.rejects(consultingDomains(owner,parse.parse({q:"different",cursor:first.nextCursor})),e=>e.status===400);
      await client.domain.deleteMany({where:{ownerId:owner,url:{startsWith:"bulk-"}}});
    });
    await t.test("currency/market validation and free-plan gate prevent paid calls; downgrade retains reads",async()=>{
      const before=calls;
      await assert.rejects(generateReport(owner,{...input,market:"en-US"}),e=>e.status===400);
      await assert.rejects(generateReport(owner,{...input,monthlyMarketingBudget:{amount:5,currency:"USD"}}),e=>e.status===400);
      await client.user.update({where:{id:owner},data:{plan:"free"}});
      await assert.rejects(generateReport(owner,{...input,monthlyMarketingBudget:{amount:102,currency:"KRW"}}),e=>e.code==="feature_forbidden");
      assert.ok(await getReports(owner,{domainId:domain.id,limit:20})); assert.equal(calls,before);
      await client.user.update({where:{id:owner},data:{plan:"starter"}});
    });
    await t.test("ledger query failure and configured rolling policy block generation before a paid call",async()=>{
      const before=calls;
      await client.$executeRawUnsafe('ALTER TABLE cost_ledger RENAME TO cost_ledger_offline');
      try { await assert.rejects(generateReport(owner,{...input,monthlyMarketingBudget:{amount:103,currency:"KRW"}}),e=>e.code==="rate_limited"); }
      finally { await client.$executeRawUnsafe('ALTER TABLE cost_ledger_offline RENAME TO cost_ledger'); }
      process.env.CONSULTING_GENERATION_LIMIT="1";process.env.CONSULTING_GENERATION_WINDOW_SECONDS="3600";
      try { await assert.rejects(generateReport(owner,{...input,monthlyMarketingBudget:{amount:104,currency:"KRW"}}),e=>e.code==="rate_limited"); }
      finally { delete process.env.CONSULTING_GENERATION_LIMIT; delete process.env.CONSULTING_GENERATION_WINDOW_SECONDS; }
      assert.equal(calls,before);
    });
    await t.test("invalid outputs settle actual usage once and cannot trigger automatic retries",async()=>{
      for(const [index,m] of ["bad_evidence","numeric","no_tool","json","truncated"].entries()){
        mode=m;const req={...input,monthlyMarketingBudget:{amount:200+index,currency:"KRW"}};
        const before=calls, ledger=await client.costLedger.count();
        await assert.rejects(generateReport(owner,req),e=>e.code==="llm_failed");
        await assert.rejects(generateReport(owner,req),e=>e.code==="llm_failed");
        assert.equal(calls,before+1);assert.equal(await client.costLedger.count(),ledger+1);
        const last=await client.consultingReport.findFirst({where:{status:"failed"},orderBy:{createdAt:"desc"}});assert.equal(last.strategyJson,null);assert.equal(last.reservedKrw,0);
      } mode="valid";
    });
    await t.test("timeout and missing usage retain reservation, block replay and protect domain deletion",async()=>{
      for(const [index,m] of ["timeout","no_usage"].entries()){
        mode=m;const req={...input,monthlyMarketingBudget:{amount:300+index,currency:"KRW"}};
        const before=calls, ledger=await client.costLedger.count();
        await assert.rejects(generateReport(owner,req),e=>e.code==="generation_uncertain");
        await assert.rejects(generateReport(owner,req),e=>e.code==="generation_uncertain");
        assert.equal(calls,before+1);assert.equal(await client.costLedger.count(),ledger);
      }
      const unresolved=await client.consultingReport.findMany({where:{status:"uncertain"}});
      assert.equal(unresolved.length,2);assert.ok(unresolved.every(x=>x.reservedKrw>0));
      await assert.rejects(deleteDomain(owner,domain.id),e=>e.status===409);mode="valid";
    });
    await t.test("consulting reserves block GEO/SEO and their reserves block consulting",async()=>{
      const { pendingReservedKrw, checkCaptureBudget }=require("../../visibility/budget.ts");
      const { checkSeoBudget }=require("../../seo/budget.ts");
      assert.ok(await pendingReservedKrw(client,owner)>0);
      await client.setting.update({where:{ownerId:owner},data:{budgetMonthly:1}});
      const before=calls;
      await assert.rejects(generateReport(owner,{...input,monthlyMarketingBudget:{amount:400,currency:"KRW"}}),e=>e.status===429);
      await assert.rejects(checkSeoBudget(client,owner,"starter",1),e=>e.status===429);
      await assert.rejects(checkCaptureBudget(client,owner,{plan:"starter",budgetMonthly:1,queryCount:0},1),e=>e.status===429);
      assert.equal(calls,before);
      await client.consultingReport.updateMany({where:{status:"uncertain"},data:{status:"failed",reservedKrw:0}}); // Explicit operator reconciliation in test only.
      const q=await client.visibilityQuery.create({data:{ownerId:owner,domainId:domain.id,query:"test",engines:["gemini"],brandAliases:["test"],competitorAliases:[]}});
      await client.visibilitySnapshot.create({data:{queryId:q.id,engine:"gemini",runKey:"reserve",status:"pending",source:"test"}});
      await client.setting.update({where:{ownerId:owner},data:{budgetMonthly:1000}});
      await assert.rejects(generateReport(owner,{...input,monthlyMarketingBudget:{amount:401,currency:"KRW"}}),e=>e.status===429);
      await client.visibilitySnapshot.deleteMany();
      await client.setting.update({where:{ownerId:owner},data:{budgetMonthly:100000}});
    });
    await t.test("settlement rollback leaves no orphan ledger and retains reserve for reconciliation",async()=>{
      await client.$executeRawUnsafe(`CREATE FUNCTION reject_consulting_settlement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='completed' THEN RAISE EXCEPTION 'simulated write failure'; END IF; RETURN NEW; END $$`);
      await client.$executeRawUnsafe('CREATE TRIGGER reject_settlement BEFORE UPDATE ON consulting_reports FOR EACH ROW EXECUTE FUNCTION reject_consulting_settlement()');
      const before=await client.costLedger.count();
      await assert.rejects(generateReport(owner,{...input,monthlyMarketingBudget:{amount:500,currency:"KRW"}}),e=>e.code==="generation_uncertain");
      assert.equal(await client.costLedger.count(),before);
      const row=await client.consultingReport.findFirst({where:{status:"uncertain"}});assert.ok(row.reservedKrw>0);assert.equal(row.ledgerId,null);
      await client.$executeRawUnsafe('DROP TRIGGER reject_settlement ON consulting_reports');
      await client.$executeRawUnsafe('DROP FUNCTION reject_consulting_settlement()');
      await client.consultingReport.updateMany({where:{status:"uncertain"},data:{status:"failed",reservedKrw:0}});
    });
    await t.test("history cursor is scoped, deletion cascades reports and preserves all cost/audit rows",async()=>{
      const first=await getReports(owner,{domainId:domain.id,limit:1});assert.ok(first.nextCursor);
      const second=await getReports(owner,{domainId:domain.id,limit:1,cursor:first.nextCursor});assert.notEqual(first.items[0].id,second.items[0].id);
      await assert.rejects(getReports(owner,{domainId:other.id,limit:1,cursor:first.nextCursor}),e=>e.status===400);
      const before=await client.costLedger.count();await deleteDomain(owner,domain.id);
      assert.equal(await client.consultingReport.count(),0);assert.equal(await client.costLedger.count(),before);
      assert.ok(await client.auditLog.count({where:{action:"consulting.completed"}}));
    });
  } finally { if(client)await client.$disconnect();if(server)await server.stop();await db.close(); }
});
