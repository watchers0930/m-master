/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, __dirname, process */
// 광고(네이버 검색광고) 데이터 모델 — 실DB(PGlite)로 유니크·FK·수동 마이그레이션 동등성을 확인한다.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process'),{createRequire}=require('node:module');
const packageDir=process.env.PGLITE_SOCKET_PACKAGE;
const skip=!packageDir&&'Set PGLITE_SOCKET_PACKAGE';
const root=path.resolve(__dirname,'../../..');
const migrationsDir=path.join(root,'prisma/manual-migrations');
const MIGRATION='20261110_ads_phase4_1.sql';
const MIRRORS=['ad_campaigns','ad_groups','ad_keywords','ad_creatives'];

function targetDdl(){
 return execFileSync(path.join(root,'node_modules/.bin/prisma'),['migrate','diff','--from-empty','--to-schema-datamodel',path.join(root,'prisma/schema.prisma'),'--script'],{encoding:'utf8'})
  .replace(/CREATE EXTENSION[^;]*;/g,'').replace(/vector\(1536\)/g,'TEXT');
}
async function freshDb(){
 const {PGlite}=createRequire(path.join(packageDir,'package.json'))('@electric-sql/pglite');
 const db=await PGlite.create();await db.exec(targetDdl());
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
  await t.test('performance upsert key unique',async()=>{
   const perf=(id,date)=>`INSERT INTO ad_performance_daily(id,owner_id,ad_account_id,entity_type,naver_id,date,imp_cnt,clk_cnt,cost_krw,ccnt) VALUES ('${id}','owner','acc1','keyword','kw-1','${date}',10,1,500,0)`;
   await db.exec(perf('p1','2026-11-10'));
   await assert.rejects(db.exec(perf('p2','2026-11-10')),/unique/i);
   await db.exec(perf('p3','2026-11-11'));
   await db.exec("INSERT INTO ad_performance_daily(id,owner_id,ad_account_id,entity_type,naver_id,date,imp_cnt,clk_cnt,cost_krw,ccnt) VALUES ('p1b','owner','acc1','keyword','kw-1','2026-11-10',20,2,900,1) ON CONFLICT (naver_id,date) DO UPDATE SET cost_krw=EXCLUDED.cost_krw");
   assert.equal((await db.query("SELECT cost_krw FROM ad_performance_daily WHERE id='p1'")).rows[0].cost_krw,900);
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

// 수동 SQL = (HEAD 상태) + 이 파일 → 목표 스키마와 구조가 같아야 한다. HEAD 상태는 목표 DDL에서 이 파일이 만드는 테이블만 지워 재현한다.
async function catalog(db,tables){
 const list=tables.map(n=>`'${n}'`).join(',');
 const cols=(await db.query(`SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name IN (${list}) ORDER BY 1,2`)).rows;
 const idx=(await db.query(`SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN (${list}) ORDER BY 1,2`)).rows;
 const cons=(await db.query(`SELECT c.conrelid::regclass::text AS t,c.conname,pg_get_constraintdef(c.oid) AS def FROM pg_constraint c WHERE c.conrelid::regclass::text IN (${list}) ORDER BY 1,2`)).rows;
 return {cols,idx,cons};
}
test('manual SQL is additive and applies cleanly on top of the HEAD schema (twice), matching the target',{skip},async()=>{
 const sql=fs.readFileSync(path.join(migrationsDir,MIGRATION),'utf8');
 const created=[...sql.matchAll(/CREATE TABLE IF NOT EXISTS "([a-z_]+)"/g)].map(m=>m[1]);
 assert.equal(created.length,9,'creates all 9 ad tables');
 assert.ok(created.every(n=>n.startsWith('ad_')),'only ad_* tables');
 assert.doesNotMatch(sql,/\bDROP\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|\bUPDATE\s+"/i,'no destructive statements');
 for(const m of sql.matchAll(/ALTER TABLE "([a-z_]+)"/g)) assert.ok(m[1].startsWith('ad_'),`ALTER only on new tables: ${m[1]}`);
 const target=await freshDb(),base=await freshDb();
 try{
  await base.exec(created.map(n=>`DROP TABLE "${n}" CASCADE;`).join('\n'));
  const later=fs.readdirSync(migrationsDir).filter(f=>f.endsWith('.sql')&&f>=MIGRATION).sort();
  for(const f of later) await base.exec(fs.readFileSync(path.join(migrationsDir,f),'utf8'));
  await base.exec(sql); // 재실행 안전(IF NOT EXISTS·중복 FK 무시)
  assert.deepEqual(await catalog(base,created),await catalog(target,created));
  // 기존 테이블은 건드리지 않는다: users 구조 동일
  assert.deepEqual(await catalog(base,['users']),await catalog(target,['users']));
 }finally{await target.close();await base.close();}
});
