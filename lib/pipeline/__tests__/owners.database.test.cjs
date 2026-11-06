/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, __dirname, process */
require('../../visibility/__tests__/register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path');
const {execFileSync}=require('node:child_process'),{createRequire}=require('node:module');
const packageDir=process.env.PGLITE_SOCKET_PACKAGE;
// 파이프라인 권한 = users.plan(앱 표준) + 연체 제외. 두 진입점(sweep·단건 판정)이 같은 규칙을 쓰는지 실DB로 확인.
test('pipeline entitlement: paid plan with no subscription row or an active one; past_due/canceled blocked; sweep and per-owner agree',{skip:!packageDir&&'Set PGLITE_SOCKET_PACKAGE'},async()=>{
 const runtime=createRequire(path.join(packageDir,'package.json'));
 const {PGlite}=runtime('@electric-sql/pglite'),{PGLiteSocketServer}=runtime('@electric-sql/pglite-socket');
 const {PrismaClient}=require('@prisma/client'),root=path.resolve(__dirname,'../../..');
 const db=await PGlite.create();let server,client;
 try{
  const ddl=execFileSync(path.join(root,'node_modules/.bin/prisma'),['migrate','diff','--from-empty','--to-schema-datamodel',path.join(root,'prisma/schema.prisma'),'--script'],{encoding:'utf8'}).replace(/CREATE EXTENSION[^;]*;/g,'').replace(/vector\(1536\)/g,'TEXT');
  await db.exec(ddl);
  const owners=[['granted','pro',null],['paid','starter','active'],['late','pro','past_due'],['halfcanceled','pro','canceled'],['freeuser','free',null],['nodomain','pro',null]];
  for(const [id,plan] of owners) await db.exec(`INSERT INTO users(id,email,password_hash,plan,updated_at) VALUES ('${id}','${id}@test','unused','${plan}',now())`);
  for(const [id,,status] of owners) if(status) await db.exec(`INSERT INTO subscriptions(id,user_id,stripe_sub_id,plan,status) VALUES ('s_${id}','${id}','sub_${id}','pro','${status}')`);
  for(const [id] of owners){
   if(id!=='nodomain') await db.exec(`INSERT INTO domains(id,owner_id,url) VALUES ('d_${id}','${id}','${id}.test')`);
   await db.exec(`INSERT INTO settings(id,owner_id,automation_domain_id) VALUES ('st_${id}','${id}',${id==='nodomain'?'NULL':`'d_${id}'`})`);
  }
  server=new PGLiteSocketServer({db,port:0,host:'127.0.0.1'});await server.start();
  let address=server.getServerConn();if(!address.startsWith('postgres'))address='postgresql://postgres:postgres@'+address+'/postgres';
  client=new PrismaClient({datasources:{db:{url:address+(address.includes('?')?'&':'?')+'connection_limit=1&sslmode=disable'}}});
  require.cache[require.resolve('../../prisma.ts')]={exports:{prisma:client}};
  const {pipelineOwners,pipelineOwnerReason}=require('../owners.ts');
  const swept=[];for await(const o of pipelineOwners()) swept.push(o.ownerId);
  assert.deepEqual(swept.sort(),['granted','paid']);
  assert.equal(await pipelineOwnerReason('granted'),null);
  assert.equal(await pipelineOwnerReason('paid'),null);
  assert.equal(await pipelineOwnerReason('late'),'plan_limit');
  assert.equal(await pipelineOwnerReason('halfcanceled'),'plan_limit'); // plan still pro, subscription canceled
  assert.equal(await pipelineOwnerReason('freeuser'),'plan_limit');
  assert.equal(await pipelineOwnerReason('nodomain'),'no_automation_domain');
  const single=[];for await(const o of pipelineOwners('late')) single.push(o);
  assert.deepEqual(single,[]);
 }finally{await client?.$disconnect();await server?.stop();await db.close();}
});
