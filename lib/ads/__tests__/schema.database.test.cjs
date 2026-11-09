/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, __dirname, process */
// 광고(네이버 검색광고) 데이터 모델 — 실DB(PGlite)로 유니크·FK·수동 마이그레이션 동등성을 확인한다.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{isDeepStrictEqual}=require('node:util');
const {execFileSync}=require('node:child_process'),{createRequire}=require('node:module');
const packageDir=process.env.PGLITE_SOCKET_PACKAGE;
const skip=!packageDir&&'Set PGLITE_SOCKET_PACKAGE';
const root=path.resolve(__dirname,'../../..');
const migrationsDir=path.join(root,'prisma/manual-migrations');
const MIGRATION='20261110_ads_phase4_1.sql';
const MIRRORS=['ad_campaigns','ad_groups','ad_keywords','ad_creatives'];

const TARGET_SCHEMA=path.join(root,'prisma/schema.prisma');
// 이 마이그레이션의 기준 스키마 = Task 2 직전 커밋 8b70c21(영구 고정). git 없는 환경을 위해 fixture로 커밋하고, git이 있으면 동일성을 확인한다.
const PRE_COMMIT='8b70c21',PRE_SCHEMA=path.join(__dirname,'fixtures/pre-ads.schema.prisma');
const ddlCache=new Map();
function targetDdl(schemaPath=TARGET_SCHEMA){
 if(!ddlCache.has(schemaPath)) ddlCache.set(schemaPath,execFileSync(path.join(root,'node_modules/.bin/prisma'),['migrate','diff','--from-empty','--to-schema-datamodel',schemaPath,'--script'],{encoding:'utf8'})
  .replace(/CREATE EXTENSION[^;]*;/g,'').replace(/vector\(1536\)/g,'TEXT'));
 return ddlCache.get(schemaPath);
}
async function emptyDb(){
 const {PGlite}=createRequire(path.join(packageDir,'package.json'))('@electric-sql/pglite');
 return PGlite.create();
}
async function freshDb(){
 const db=await emptyDb();await db.exec(targetDdl());
 await db.exec("INSERT INTO users(id,email,password_hash,updated_at) VALUES ('owner','owner@test','unused',now()),('other','other@test','unused',now())");
 return db;
}
const account=(id,owner,customer)=>`INSERT INTO ad_accounts(id,owner_id,naver_customer_id,label,api_key_enc,secret_key_enc,key_last4,updated_at) VALUES ('${id}','${owner}','${customer}','라벨','enc','enc','abcd',now())`;
const mirror=(table,id,acc,naverId)=>table==='ad_keywords'
 ?`INSERT INTO ad_keywords(id,owner_id,ad_account_id,naver_id,name,keyword,updated_at) VALUES ('${id}','owner','${acc}','${naverId}','n','키워드',now())`
 :table==='ad_creatives'
  ?`INSERT INTO ad_creatives(id,owner_id,ad_account_id,naver_id,name,headline,description,updated_at) VALUES ('${id}','owner','${acc}','${naverId}','n','제목','설명',now())`
  :`INSERT INTO ${table}(id,owner_id,ad_account_id,naver_id,name,updated_at) VALUES ('${id}','owner','${acc}','${naverId}','n',now())`;

test('ads schema constraints on a real Postgres (PGlite)',{skip},async t=>{
 const db=await freshDb();
 try{
  await db.exec(account('acc1','owner','111'));
  await t.test('unique account per owner',async()=>{
   await assert.rejects(db.exec(account('dup','owner','111')),/unique/i);
   await db.exec(account('acc-other','other','111')); // 다른 소유자는 같은 customerId 허용
   await db.exec(account('acc2','owner','222'));
  });
  await t.test('defaults follow global constraints (cap 100k, shared budget 100k, max bid 2000, active, userLock on)',async()=>{
   const row=(await db.query("SELECT daily_cap_krw,shared_budget_krw,max_bid_krw,status FROM ad_accounts WHERE id='acc1'")).rows[0];
   assert.deepEqual(row,{daily_cap_krw:100000,shared_budget_krw:100000,max_bid_krw:2000,status:'active'});
   await db.exec(mirror('ad_campaigns','c-default','acc1','cmp-default'));
   const m=(await db.query("SELECT user_lock,locked_by FROM ad_campaigns WHERE id='c-default'")).rows[0];
   assert.deepEqual(m,{user_lock:true,locked_by:null});
  });
  await t.test('alert dedupe unique',async()=>{
   const alert=id=>`INSERT INTO ad_alerts(id,owner_id,ad_account_id,type,kst_date,payload) VALUES ('${id}','owner','acc1','cap_90','2026-11-10','{}')`;
   await db.exec(alert('al1'));
   await assert.rejects(db.exec(alert('al2')),/unique/i);
   await db.exec("INSERT INTO ad_alerts(id,owner_id,ad_account_id,type,kst_date,payload) VALUES ('al3','owner','acc1','cap_90','2026-11-11','{}')");
  });
  await t.test('performance upsert key unique per account',async()=>{
   const perf=(id,acc,date,cost=500)=>`INSERT INTO ad_performance_daily(id,owner_id,ad_account_id,entity_type,naver_id,date,imp_cnt,clk_cnt,cost_krw,ccnt) VALUES ('${id}','owner','${acc}','keyword','kw-1','${date}',10,1,${cost},0)`;
   await db.exec(perf('p1','acc1','2026-11-10'));
   await assert.rejects(db.exec(perf('p2','acc1','2026-11-10')),/unique/i);
   await db.exec(perf('p3','acc1','2026-11-11'));
   await db.exec(perf('p1b','acc1','2026-11-10',900)+' ON CONFLICT (ad_account_id,naver_id,date) DO UPDATE SET cost_krw=EXCLUDED.cost_krw');
   assert.equal((await db.query("SELECT cost_krw FROM ad_performance_daily WHERE id='p1'")).rows[0].cost_krw,900);
  });
  await t.test('same naverId+date in two accounts both insert (delegated owners never collide)',async()=>{
   await db.exec("INSERT INTO ad_performance_daily(id,owner_id,ad_account_id,entity_type,naver_id,date,imp_cnt,clk_cnt,cost_krw,ccnt) VALUES ('px-other','other','acc-other','keyword','kw-1','2026-11-10',1,0,70,0)");
   const rows=(await db.query("SELECT ad_account_id,cost_krw FROM ad_performance_daily WHERE naver_id='kw-1' AND date='2026-11-10' ORDER BY ad_account_id")).rows;
   assert.deepEqual(rows,[{ad_account_id:'acc-other',cost_krw:70},{ad_account_id:'acc1',cost_krw:900}]);
  });
  await t.test('disconnect: key ciphertext and last4 can be erased while the row stays (status=disabled)',async()=>{
   await db.exec("UPDATE ad_accounts SET api_key_enc=NULL,secret_key_enc=NULL,key_last4=NULL,status='disabled' WHERE id='acc-other'");
   const row=(await db.query("SELECT api_key_enc,secret_key_enc,key_last4,status FROM ad_accounts WHERE id='acc-other'")).rows[0];
   assert.deepEqual(row,{api_key_enc:null,secret_key_enc:null,key_last4:null,status:'disabled'});
   assert.equal((await db.query("SELECT count(*)::int AS n FROM ad_performance_daily WHERE ad_account_id='acc-other'")).rows[0].n,1); // 성과 보존
  });
  await t.test('mirror naverId unique per account',async()=>{
   for(const table of MIRRORS){
    await db.exec(mirror(table,`${table}-1`,'acc1',`nv-${table}`));
    await assert.rejects(db.exec(mirror(table,`${table}-dup`,'acc1',`nv-${table}`)),/unique/i,table);
    await db.exec(mirror(table,`${table}-acc2`,'acc2',`nv-${table}`));
   }
  });
  await t.test('cannot delete AdAccount with dependent rows (no silent cascade)',async()=>{
   await db.exec("INSERT INTO ad_proposals(id,owner_id,ad_account_id,kind,payload,updated_at) VALUES ('pr1','owner','acc2','new_campaign','{}',now())");
   await db.exec("INSERT INTO ad_operation_logs(id,owner_id,ad_account_id,proposal_id,step,method,path,request_hash) VALUES ('op1','owner','acc2','pr1','campaign','POST','/ncc/campaigns','h')");
   await assert.rejects(db.exec("DELETE FROM ad_accounts WHERE id='acc2'"),/foreign key/i);
   await assert.rejects(db.exec("DELETE FROM ad_accounts WHERE id='acc1'"),/foreign key/i);
   await assert.rejects(db.exec("DELETE FROM ad_proposals WHERE id='pr1'"),/foreign key/i);
   await assert.rejects(db.exec("DELETE FROM users WHERE id='owner'"),/foreign key/i);
   // 의존 행이 없는 계정은 삭제 가능(정상 경로는 status=disabled 소프트 삭제)
   await db.exec(account('lonely','other','999'));await db.exec("DELETE FROM ad_accounts WHERE id='lonely'");
   assert.equal((await db.query("SELECT count(*)::int AS n FROM ad_campaigns")).rows[0].n,3); // c-default + acc1 + acc2 — 실패한 DELETE가 아무것도 지우지 않았다
  });
 }finally{await db.close();}
});

// 수동 SQL 동등성: 고정 사전 스키마(8b70c21) DDL + (이 파일과 이후 manual 파일, 2회) → public 전체 카탈로그가 목표 schema.prisma DDL과 같아야 한다.
async function catalog(db){
 const q=async sql=>(await db.query(sql)).rows;
 return {
  tables:await q(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY 1`),
  columns:await q(`SELECT c.relname,a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) AS dflt
   FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
   WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2`),
  indexes:await q(`SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY 1,2`),
  constraints:await q(`SELECT c.conrelid::regclass::text AS t,c.conname,c.contype,pg_get_constraintdef(c.oid) AS def FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' ORDER BY 1,2`),
  enums:await q(`SELECT t.typname,e.enumsortorder,e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' ORDER BY 1,2`),
 };
}
async function applyOnPre(sqlText){
 const db=await emptyDb();
 await db.exec(targetDdl(PRE_SCHEMA));
 const files=fs.readdirSync(migrationsDir).filter(f=>f.endsWith('.sql')&&f>=MIGRATION).sort();
 const run=async()=>{for(const f of files) await db.exec(f===MIGRATION?sqlText:fs.readFileSync(path.join(migrationsDir,f),'utf8'));};
 await run();await run(); // 재실행 안전(IF NOT EXISTS·중복 FK 무시)
 return db;
}
async function compare(sqlText,targetSchema=TARGET_SCHEMA){
 const base=await applyOnPre(sqlText),target=await emptyDb();
 try{await target.exec(targetDdl(targetSchema));return {base:await catalog(base),target:await catalog(target)};}
 finally{await base.close();await target.close();}
}
const sameCatalog=r=>isDeepStrictEqual(r.base,r.target);

test('manual SQL on the pinned pre-ads schema (8b70c21), applied twice, equals the target schema catalog — and the gate can fail',{skip},async t=>{
 const sql=fs.readFileSync(path.join(migrationsDir,MIGRATION),'utf8');
 await t.test('static: additive only',()=>{
  const created=[...sql.matchAll(/CREATE TABLE IF NOT EXISTS "([a-z_]+)"/g)].map(m=>m[1]);
  assert.equal(created.length,9,'creates all 9 ad tables');
  assert.ok(created.every(n=>n.startsWith('ad_')),'only ad_* tables');
  assert.doesNotMatch(sql,/\bDROP\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|\bUPDATE\s+"/i,'no destructive statements');
  for(const m of sql.matchAll(/ALTER TABLE "([a-z_]+)"/g)) assert.ok(m[1].startsWith('ad_'),`ALTER only on new tables: ${m[1]}`);
 });
 await t.test('pinned base is the real pre-task schema',()=>{
  const fixture=fs.readFileSync(PRE_SCHEMA,'utf8');
  assert.doesNotMatch(fixture,/model Ad[A-Z]/,'base has no ad models');
  let fromGit=null;
  try{fromGit=execFileSync('git',['show',`${PRE_COMMIT}:prisma/schema.prisma`],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']});}catch{/* git 없음: 커밋된 fixture 사용 */}
  if(fromGit!==null) assert.equal(fixture,fromGit,'fixture == git show 8b70c21:prisma/schema.prisma');
 });
 await t.test('equivalence: whole public catalog (tables·columns·types·nullability·defaults·indexes·constraints·FKs·enums)',async()=>{
  const r=await compare(sql);
  assert.ok(r.target.tables.some(x=>x.relname==='ad_accounts'));
  assert.deepEqual(r.base,r.target);
 });
 // 게이트가 실제로 실패할 수 있는지(변이 검증) — 각 변이는 반드시 불일치여야 한다.
 await t.test('mutation: dropping one index line fails the gate',async()=>{
  const mutated=sql.replace(/^CREATE INDEX IF NOT EXISTS "ad_keywords_ad_account_id_locked_by_idx"[^\n]*\n/m,'');
  assert.notEqual(mutated,sql);
  assert.equal(sameCatalog(await compare(mutated)),false);
 });
 await t.test('mutation: dropping a statement that touches an existing object (FK to users) fails the gate',async()=>{
  const mutated=sql.replace(/DO \$\$ BEGIN\n IF NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE conname = 'ad_accounts_owner_id_fkey'[\s\S]*?END \$\$;\n/,'');
  assert.notEqual(mutated,sql);
  assert.equal(sameCatalog(await compare(mutated)),false);
 });
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ads-schema-'));
 try{
  const target=fs.readFileSync(TARGET_SCHEMA,'utf8');
  await t.test('mutation: schema adds a column to existing users table without a matching ALTER fails the gate',async()=>{
   const p=path.join(dir,'users-col.prisma');
   const mutated=target.replace(/(model User \{[^\n]*\n)/,'$1  mutantCol String? @map("mutant_col")\n');
   assert.notEqual(mutated,target);fs.writeFileSync(p,mutated);
   assert.equal(sameCatalog(await compare(sql,p)),false);
  });
  await t.test('mutation: schema adds an enum without a matching CREATE TYPE fails the gate',async()=>{
   const p=path.join(dir,'enum.prisma');
   fs.writeFileSync(p,target+'\nenum MutantKind {\n  a\n  b\n}\n');
   assert.equal(sameCatalog(await compare(sql,p)),false);
  });
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
