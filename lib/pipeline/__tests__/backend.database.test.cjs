/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, __dirname, process, Request */
require('../../visibility/__tests__/register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process'),{createRequire}=require('node:module');
const packageDir=process.env.PGLITE_SOCKET_PACKAGE;
test('isolated GA4 pipeline migration, review CAS, worker claims and publish boundaries',{skip:!packageDir&&'Set PGLITE_SOCKET_PACKAGE'},async t=>{
 const runtime=createRequire(path.join(packageDir,'package.json'));
 const {PGlite}=runtime('@electric-sql/pglite'),{PGLiteSocketServer}=runtime('@electric-sql/pglite-socket');
 const {PrismaClient}=require('@prisma/client'),root=path.resolve(__dirname,'../../..');
 const db=await PGlite.create();let server,client,owner='owner',sends=0;
 // 세션 TimeZone 을 UTC 아닌 값으로 고정 — raw SQL 이 세션 TZ 와 무관하게 UTC(Prisma 저장 기준)로 비교·기록하는지 호스트 TZ 와 상관없이 검증
 await db.exec("SET TIME ZONE 'Asia/Seoul'");
 try{
  const ddl=execFileSync(path.join(root,'node_modules/.bin/prisma'),['migrate','diff','--from-empty','--to-schema-datamodel',path.join(root,'prisma/schema.prisma'),'--script'],{encoding:'utf8'}).replace(/CREATE EXTENSION[^;]*;/g,'').replace(/vector\(1536\)/g,'TEXT');
  await db.exec(ddl);
  await db.exec("INSERT INTO users(id,email,password_hash,updated_at) VALUES ('owner','owner@test','unused',now()),('foreign','foreign@test','unused',now())");
  await db.exec("INSERT INTO contents(id,owner_id,channel,topic,keywords,body_image_urls,updated_at) VALUES ('legacy','owner','blog','legacy','{}','{}',now())");
  await db.exec('ALTER TABLE contents DROP COLUMN origin, DROP COLUMN review_status, DROP COLUMN reviewed_at, DROP COLUMN reviewed_by, DROP COLUMN parent_content_id, DROP COLUMN strategy_context');
  const migration=fs.readFileSync(path.join(root,'prisma/manual-migrations/20261104_ga4_pipeline.sql'),'utf8');
  await t.test('additive migration is repeatable and preserves truthful legacy review defaults',async()=>{
   await db.exec(migration);await db.exec(migration);
   const row=(await db.query("SELECT origin,review_status,reviewed_at FROM contents WHERE id='legacy'")).rows[0];
   // 20261104 1회성 백필: 예약 슬롯 없는 과거 미발행 draft는 pending_review(무승인 블로그 발행 차단, e147e96)
   assert.deepEqual(row,{origin:'manual',review_status:'pending_review',reviewed_at:null});
   await assert.rejects(db.exec("UPDATE contents SET review_status='forged' WHERE id='legacy'"));
  });
  server=new PGLiteSocketServer({db,port:0,host:'127.0.0.1'});await server.start();
  let address=server.getServerConn();if(!address.startsWith('postgres'))address='postgresql://postgres:postgres@'+address+'/postgres';
  client=new PrismaClient({datasources:{db:{url:address+(address.includes('?')?'&':'?')+'connection_limit=1&sslmode=disable'}}});
  require.cache[require.resolve('../../prisma.ts')]={exports:{prisma:client}};
  require.cache[require.resolve('../../auth.ts')]={exports:{requireSession:async()=>{if(!owner)throw Error('Unauthorized');return {user:{id:owner}};}}};
  require.cache[require.resolve('../../publish/channels.ts')]={exports:{sendChannel:async()=>{sends++;return {externalId:'posted',externalUrl:'https://facebook.com/posted'};}}};
  require.cache[require.resolve('../../publish/derive.ts')]={exports:{deriveCafeContent:async()=>({status:'skipped',childContentId:null,reason:'no_credentials'})}};
  const {createContentRecord}=require('../../content/writer.ts');
  const {reviewContentRecord,editContentRecord}=require('../../content/review.ts');
  const {publishContentNow}=require('../../publish/service.ts');
  const {claimPipelineRun,finishPipelineRun}=require('../run-claim.ts');
  const {pendingBlogContent,verifyWorkerClaim,completeWorkerClaim}=require('../../publish/worker.ts');
  const make=(origin='auto',channel='facebook',extra={})=>createContentRecord(client,{origin,channel,ownerId:'owner',topic:'test',keywords:[],bodyImageUrls:[],textBody:'body',...extra});
  await t.test('all writer origins explicitly derive review state; unapproved publish sends nothing',async()=>{
   for(const origin of ['manual','auto']){
    const {id}=await make(origin);const row=await client.content.findUnique({where:{id}});
    assert.equal(row.reviewStatus,origin==='auto'?'pending_review':'approved');
    if(origin==='auto')await assert.rejects(publishContentNow({ownerId:'owner',contentId:id,channel:'facebook',trigger:'manual'}),e=>e.code==='not_approved');
   }assert.equal(sends,0);
  });
  await t.test('approve/reject CAS has one winner and exactly one audit; replays are idempotent',async()=>{
   const {id}=await make(),row=await client.content.findUnique({where:{id}});
   const input={expected_updated_at:row.updatedAt.toISOString()};
   const results=await Promise.allSettled([reviewContentRecord('owner',id,{...input,decision:'approve'}),reviewContentRecord('owner',id,{...input,decision:'reject'})]);
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
   assert.equal(await client.auditLog.count({where:{targetId:id,action:{in:['content.review_approve','content.review_reject']}}}),1);
   const current=await client.content.findUnique({where:{id}});
   const replay=await reviewContentRecord('owner',id,{...input,decision:current.reviewStatus==='approved'?'approve':'reject'});
   assert.equal(replay.changed,false);
   if(current.reviewStatus==='approved'){
    await editContentRecord('owner',id,{expected_updated_at:current.updatedAt.toISOString(),topic:'edited'});
    assert.equal((await client.content.findUnique({where:{id}})).reviewStatus,'pending_review');
    assert.equal(await client.auditLog.count({where:{targetId:id,action:'content.review_reset'}}),1);
   }
  });
  await t.test('Origin, strict body, stale versions, foreign IDs and pagination are enforced by actual routes',async()=>{
   const route=require('../../../app/api/content/[id]/review/route.ts');
   const {id}=await make(),row=await client.content.findUnique({where:{id}});
   const context={params:Promise.resolve({id})},body={decision:'approve',expected_updated_at:row.updatedAt.toISOString()};
   const req=(extra={},headers={})=>new Request('https://app.test/api/content/'+id+'/review',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({...body,...extra})});
   assert.equal((await route.POST(req(),context)).status,403);
   assert.equal((await route.POST(req({owner_id:'foreign'},{origin:'https://app.test'}),context)).status,400);
   owner='foreign';assert.equal((await route.POST(req({},{origin:'https://app.test'}),context)).status,404);owner='owner';
   assert.equal((await route.POST(req({},{origin:'https://app.test'}),context)).status,200);
   const list=require('../../../app/api/content/route.ts');
   assert.equal((await list.GET(new Request('https://app.test/api/content?per_page=101'))).status,400);
   const payload=await (await list.GET(new Request('https://app.test/api/content?review_status=pending_review&per_page=1'))).json();
   assert.equal(payload.data.items.length,1);assert.equal(payload.data.items[0].review_status,'pending_review');
  });
  await t.test('worker allowlist, lease expiry, forged completions, recheck and complete replay are safe',async()=>{
   const {requireWorker}=require('../../publish/worker-auth.ts');
   const workerReq=ownerHeader=>new Request('https://app.test/api/blog-publish/pending',{headers:{'x-api-key':process.env.BLOG_PUBLISH_API_KEY,'x-blog-worker-protocol':'claim-v1','x-blog-worker-owner':ownerHeader}});
   process.env.BLOG_PUBLISH_API_KEY='k'.repeat(40);process.env.BLOG_PUBLISH_OWNER_IDS='';
   assert.throws(()=>requireWorker(workerReq('owner')),e=>e.code==='owner_not_allowed');
   process.env.BLOG_PUBLISH_OWNER_IDS='owner,foreign';
   await make('manual','blog',{ownerId:'foreign',createdAt:new Date('2024-01-01')});
   assert.equal((await pendingBlogContent('owner')).items.every(i=>i.ownerId==='owner'),true,'다른 소유자 콘텐츠는 이 작업자에게 오지 않는다');
   await client.publishClaim.deleteMany({where:{trigger:'worker'}});
   process.env.BLOG_PUBLISH_OWNER_IDS='owner';
   await client.content.updateMany({where:{channel:'blog'},data:{reviewStatus:'pending_review'}});
   const {id}=await make('manual','blog',{createdAt:new Date('2025-01-01')});
   const pending=await pendingBlogContent('owner');assert.equal(pending.items[0].id,id);const token=pending.items[0].claim.token;
   await assert.rejects(completeWorkerClaim('owner',id,'forged','https://blog.naver.com/a/1'),e=>e.code==='claim_invalid');
   await assert.rejects(editContentRecord('owner',id,{expected_updated_at:pending.items[0].claim.contentVersion.toISOString(),topic:'race'}),e=>e.code==='publish_in_progress');
   const initialLease=(await client.publishClaim.findFirst({where:{targetId:id}})).leaseUntil;
   assert.equal((await verifyWorkerClaim('owner',id,token)).ok,true);
   assert.ok((await client.publishClaim.findFirst({where:{targetId:id}})).leaseUntil>=initialLease);
   await completeWorkerClaim('owner',id,token,'https://blog.naver.com/a/1');await completeWorkerClaim('owner',id,token,'https://blog.naver.com/a/1');
   assert.equal(await client.auditLog.count({where:{targetId:id,action:'publish.blog'}}),1);
   assert.equal(await client.scheduleSlot.count({where:{contentId:id,status:'published'}}),1);
   assert.equal((await pendingBlogContent('owner')).reason,'daily_limit_reached');
   await client.publishClaim.updateMany({where:{targetId:id},data:{finishedAt:new Date('2025-01-01')}});
   const next=await make('manual','blog');const pending2=await pendingBlogContent('owner');assert.equal(pending2.items[0].id,next.id);
   await client.publishClaim.updateMany({where:{targetId:next.id},data:{leaseUntil:new Date(0)}});
   await pendingBlogContent('owner');
   assert.equal((await client.publishClaim.findFirst({where:{targetId:next.id}})).status,'unknown');
   await client.content.update({where:{id:next.id},data:{reviewStatus:'rejected'}}); // External post already exists: completion records the fact.
   await completeWorkerClaim('owner',next.id,pending2.items[0].claim.token,'https://blog.naver.com/a/2');
   assert.equal((await client.publishClaim.findFirst({where:{targetId:next.id}})).status,'sent');
  });
  await t.test('manual and automatic contents pass the identical channel/review matrix',async()=>{
   const before=sends;
   for(const origin of ['manual','auto'])for(const channel of ['facebook','instagram','naver_cafe'])for(const reviewStatus of ['pending_review','approved','rejected']){
    const {id}=await make(origin,channel);
    await client.content.updateMany({where:{id,ownerId:'owner'},data:{reviewStatus}});
    const count=sends;
    if(reviewStatus==='approved'){
     await publishContentNow({ownerId:'owner',contentId:id,channel,trigger:'manual'});
     assert.equal(sends,count+1);
    }else{
     await assert.rejects(publishContentNow({ownerId:'owner',contentId:id,channel,trigger:'manual'}),e=>e.code=== (reviewStatus==='rejected'?'rejected':'not_approved'));
     assert.equal(sends,count);
    }
   }
   assert.equal(sends-before,6);
  });
  await t.test('generated content, ledger, plan item and run completion are atomic and fenced',async()=>{
   const {persistGeneratedContent}=require('../../content/persist-generated.ts');
   const plan=await client.contentPlan.create({data:{ownerId:'owner',weekKey:'atomic',items:{create:{topic:'atomic',scheduledDate:'2026-11-04',status:'generating'}}},include:{items:true}});
   const item=plan.items[0];
   const run=await claimPipelineRun({kind:'content_item',ownerId:'owner',scopeKey:item.id,periodKey:'2026-11-04'});
   const input={origin:'auto',ownerId:'owner',channel:'blog',topic:'atomic',keywords:[],bodyImageUrls:[]};
   const costs=[{kind:'chat',krw:10,tokensIn:10,tokensOut:10}],claim={id:run.id,attempts:run.attempts,planItemId:item.id};
   const row=await persistGeneratedContent(input,costs,claim);
   assert.equal((await client.content.findUnique({where:{id:row.id}})).reviewStatus,'pending_review');
   assert.equal((await client.contentPlanItem.findUnique({where:{id:item.id}})).contentJobId,row.id);
   assert.equal((await client.pipelineRun.findUnique({where:{id:run.id}})).status,'succeeded');
   assert.equal(await client.costLedger.count({where:{contentId:row.id}}),1);
   const count=await client.content.count();
   await assert.rejects(persistGeneratedContent(input,costs,claim));
   assert.equal(await client.content.count(),count);
   assert.equal(await client.costLedger.count({where:{contentId:row.id}}),1);
  });
  await t.test('topic regeneration only replaces rows in its domain scope',async()=>{
   const {persistTopics}=require('../../topics/persist.ts');
   for(const domainId of ['domain-a','domain-b','domain-a']){
    const run=await claimPipelineRun({kind:'topics',ownerId:'owner',scopeKey:domainId+':blog',periodKey:'2026-11-02'},true);
    const rows=[{ownerId:'owner',weekStart:'2026-11-02',channel:'blog',topic:domainId,score:80,factors:{domainId}}];
    const result=await persistTopics({ownerId:'owner',domainId,weekStart:'2026-11-02',rows,run,mode:'auto',metadata:{}});
    assert.equal(result.length,1);assert.equal(result[0].topic,domainId);
   }
   assert.equal(await client.topicRecommendation.count({where:{ownerId:'owner',weekStart:'2026-11-02'}}),2);
  });
  await t.test('content, ledger and audit all rollback if audit insertion fails',async()=>{
   const {persistGeneratedContent}=require('../../content/persist-generated.ts');
   const contents=await client.content.count(),ledger=await client.costLedger.count();
   await client.$executeRawUnsafe(`CREATE FUNCTION reject_content_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='content.generate' THEN RAISE EXCEPTION 'simulated audit failure'; END IF; RETURN NEW; END $$`);
   await client.$executeRawUnsafe('CREATE TRIGGER reject_content_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_content_audit()');
   try{
    await assert.rejects(persistGeneratedContent({origin:'manual',ownerId:'owner',channel:'blog',topic:'rollback',keywords:[],bodyImageUrls:[]},[{kind:'chat',krw:10,tokensIn:1,tokensOut:1}]));
    assert.equal(await client.content.count(),contents);assert.equal(await client.costLedger.count(),ledger);
   }finally{await client.$executeRawUnsafe('DROP TRIGGER reject_content_audit ON audit_log');await client.$executeRawUnsafe('DROP FUNCTION reject_content_audit()');}
  });
  await t.test('rescheduling preserves job identity and rejects claimed jobs and bad origins',async()=>{
   const route=require('../../../app/api/editor/docs/[id]/schedule/route.ts');
   const doc=await client.ideaDocument.create({data:{ownerId:'owner',title:'idea',body:'body',channel:'facebook'}});
   const context={params:Promise.resolve({id:doc.id})};
   const req=(body,origin='https://app.test')=>new Request('https://app.test/api/editor/docs/'+doc.id+'/schedule',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
   assert.equal((await route.POST(req({scheduledAt:null},'https://evil.test'),context)).status,403);
   assert.equal((await route.POST(req({scheduledAt:'invalid'}),context)).status,400);
   const scheduledAt=new Date().toISOString();
   const first=await (await route.POST(req({scheduledAt}),context)).json();
   const second=await (await route.POST(req({scheduledAt}),context)).json();assert.equal(second.data.id,first.data.id);
   await client.publishClaim.create({data:{ownerId:'owner',targetType:'idea_job',targetId:first.data.id,channel:'facebook',trigger:'schedule',token:'schedule-test-token',leaseUntil:new Date(Date.now()+60000)}});
   for(const scheduledAt of [null,new Date().toISOString()])assert.equal((await route.POST(req({scheduledAt}),context)).status,409);
   assert.equal((await client.ideaPublishJob.findUnique({where:{docId:doc.id}})).id,first.data.id);
  });
  await t.test('same pipeline period reuses success, active lease blocks concurrent runs, expired runs are fenced',async()=>{
   const key={kind:'strategy',ownerId:'owner',scopeKey:'domain',periodKey:'2026-11-02'};
   const first=await claimPipelineRun(key);assert.equal(first.acquired,true);
   assert.equal((await claimPipelineRun(key)).acquired,false);
   await client.pipelineRun.update({where:{id:first.id},data:{leaseUntil:new Date(0)}});
   const renewed=await claimPipelineRun(key);assert.equal(renewed.acquired,true);assert.equal(renewed.attempts,2);
   await finishPipelineRun(first,'failed');assert.equal((await client.pipelineRun.findUnique({where:{id:first.id}})).status,'running');
   await finishPipelineRun(renewed,'succeeded',{reportId:'report'});
   assert.equal((await claimPipelineRun(key)).acquired,false);
  });
  await t.test('expired running at the attempt cap becomes failed(lease_expired); paid cost recorded before persist survives a lost lease',async()=>{
   const key={kind:'content_item',ownerId:'owner',scopeKey:'capped',periodKey:'2026-11-05'};
   const first=await claimPipelineRun(key);assert.equal(first.acquired,true);
   await client.pipelineRun.update({where:{id:first.id},data:{attempts:4,leaseUntil:new Date(0)}});
   const capped=await claimPipelineRun(key);assert.equal(capped.acquired,false);
   const stored=await client.pipelineRun.findUnique({where:{id:first.id}});assert.equal(stored.status,'failed');assert.equal(stored.errorCode,'lease_expired');
   const {recordGenerationCosts,persistGeneratedContent}=require('../../content/persist-generated.ts');
   const recorded=await recordGenerationCosts('owner',[{kind:'chat',krw:7,tokensIn:1,tokensOut:2},{kind:'image',krw:0,tokensIn:0,tokensOut:0}]);
   assert.equal(recorded.length,1,'0원 항목은 기록하지 않음');
   const lost={id:first.id,attempts:4,planItemId:'none'};
   await assert.rejects(persistGeneratedContent({origin:'auto',ownerId:'owner',channel:'blog',topic:'lost',keywords:[],bodyImageUrls:[]},recorded,lost),/generation_lease_lost/);
   const kept=await client.costLedger.findUnique({where:{id:recorded[0].ledgerId}});assert.equal(kept.krw,7);assert.equal(kept.contentId,null);
   const row=await persistGeneratedContent({origin:'auto',ownerId:'owner',channel:'blog',topic:'linked',keywords:[],bodyImageUrls:[]},recorded);
   assert.equal((await client.costLedger.findUnique({where:{id:recorded[0].ledgerId}})).contentId,row.id);
  });
  await t.test('a GA4 property/stream can be bound by only one owner (shared service account)',async()=>{
   require.cache[require.resolve('../../ga4/auth.ts')]={exports:{invalidateGa4Credentials:()=>{}}};
   const {bindGa4}=require('../../ga4/binding.ts');
   await client.domain.createMany({data:[{id:'dom-owner',ownerId:'owner',url:'a.example.com'},{id:'dom-foreign',ownerId:'foreign',url:'b.example.com'},{id:'dom-owner2',ownerId:'owner',url:'c.example.com'}]});
   await bindGa4({owner:'owner',domain:'dom-owner',property:'123',stream:'456'});
   await assert.rejects(bindGa4({owner:'foreign',domain:'dom-foreign',property:'123'}),e=>e.code==='ga4_property_bound');
   await assert.rejects(bindGa4({owner:'foreign',domain:'dom-foreign',property:'789',stream:'456'}),e=>e.code==='ga4_property_bound');
   assert.equal(await client.ga4Binding.count({where:{ownerId:'foreign'}}),0);
   await bindGa4({owner:'owner',domain:'dom-owner2',property:'123',stream:'456'});
   await Promise.allSettled([bindGa4({owner:'foreign',domain:'dom-foreign',property:'999'}),bindGa4({owner:'owner',domain:'dom-owner',property:'999'})]);
   assert.equal(new Set((await client.ga4Binding.findMany({where:{propertyId:'properties/999'}})).map(b=>b.ownerId)).size<=1,true,'동시 바인딩도 한 소유자만');
  });
  await t.test('예약 슬롯 발행과 취소·시간변경은 행 잠금으로 직렬화 — 취소/미도래 슬롯은 전송 0, 발행 중 슬롯은 변경 409',async()=>{
   const {mutateIdleSlot}=require('../../schedule/slot-mutation.ts');
   const c=await make('manual','facebook');const past=new Date(Date.now()-60000),future=new Date(Date.now()+3600000);
   const s1=await client.scheduleSlot.create({data:{ownerId:'owner',contentId:c.id,channel:'facebook',scheduledAt:past}});
   assert.equal((await mutateIdleSlot('owner',s1.id,['scheduled','failed'],{status:'cancelled'})).ok,true);
   const before=sends;
   await assert.rejects(publishContentNow({ownerId:'owner',contentId:c.id,channel:'facebook',trigger:'schedule',scheduleSlotId:s1.id}));
   const s2=await client.scheduleSlot.create({data:{ownerId:'owner',contentId:c.id,channel:'facebook',scheduledAt:future}});
   await assert.rejects(publishContentNow({ownerId:'owner',contentId:c.id,channel:'facebook',trigger:'schedule',scheduleSlotId:s2.id}));
   assert.equal(sends,before,'취소·미도래 슬롯은 외부 전송 없음');
   // 양성 대조: 도래한 정상 슬롯은 같은 잠금 SQL 로 실제 전송되고 published 로 전이(거절이 SQL 오류 탓이 아님을 증명)
   const c2=await make('manual','facebook');
   const s0=await client.scheduleSlot.create({data:{ownerId:'owner',contentId:c2.id,channel:'facebook',scheduledAt:past}});
   await publishContentNow({ownerId:'owner',contentId:c2.id,channel:'facebook',trigger:'schedule',scheduleSlotId:s0.id});
   assert.equal(sends,before+1);
   assert.equal((await client.scheduleSlot.findUnique({where:{id:s0.id}})).status,'published');
   await client.publishClaim.create({data:{ownerId:'owner',targetType:'content',targetId:c.id,channel:'facebook',token:'tok-slot-race',trigger:'schedule',leaseUntil:future}});
   assert.deepEqual(await mutateIdleSlot('owner',s2.id,['scheduled'],{scheduledAt:past}),{ok:false,reason:'publishing'});
   assert.deepEqual(await mutateIdleSlot('foreign',s2.id,['scheduled'],{status:'cancelled'}),{ok:false,reason:'not_found'});
  });
 }finally{if(client)await client.$disconnect();if(server)await server.stop();await db.close();}
});
