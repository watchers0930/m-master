/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, __dirname, process */
// D1 근본원인 회귀: raw SQL 의 Date 매개변수·now() 는 timestamptz 라, timestamp(3) 컬럼(Prisma=UTC 벽시각)과
// 비교·대입하면 세션 TimeZone 으로 어긋난다. lib/sql-time.ts 조각은 세션 TZ 와 무관하게 Prisma 와 같은 값을 쓴다.
require('../../visibility/__tests__/register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path'),{execFileSync}=require('node:child_process'),{createRequire}=require('node:module');
const packageDir=process.env.PGLITE_SOCKET_PACKAGE;
test('sql-time: 비UTC 세션에서도 raw 비교·기록이 Prisma ORM 저장값과 일치',{skip:!packageDir&&'Set PGLITE_SOCKET_PACKAGE'},async()=>{
 const runtime=createRequire(path.join(packageDir,'package.json'));
 const {PGlite}=runtime('@electric-sql/pglite'),{PGLiteSocketServer}=runtime('@electric-sql/pglite-socket');
 const {PrismaClient,Prisma}=require('@prisma/client'),root=path.resolve(__dirname,'../../..');
 const db=await PGlite.create();let server,client;
 try{
  await db.exec("SET TIME ZONE 'Asia/Seoul'");
  const ddl=execFileSync(path.join(root,'node_modules/.bin/prisma'),['migrate','diff','--from-empty','--to-schema-datamodel',path.join(root,'prisma/schema.prisma'),'--script'],{encoding:'utf8'}).replace(/CREATE EXTENSION[^;]*;/g,'').replace(/vector\(1536\)/g,'TEXT');
  await db.exec(ddl);
  server=new PGLiteSocketServer({db,port:0,host:'127.0.0.1'});await server.start();
  let address=server.getServerConn();if(!address.startsWith('postgres'))address='postgresql://postgres:postgres@'+address+'/postgres';
  client=new PrismaClient({datasources:{db:{url:address+'?connection_limit=1&sslmode=disable'}}});
  const {utcTimestamp,UTC_NOW}=require('../../sql-time.ts');
  const at=new Date('2026-03-01T00:00:00.000Z'),later=new Date(at.getTime()+3600000);
  const slot=await client.scheduleSlot.create({data:{ownerId:'o',channel:'facebook',scheduledAt:at}});
  const where=Prisma.sql`id=${slot.id}`;
  // 양성 대조: 매개변수를 그대로 쓰면 세션 TZ 로 어긋난다(이 환경이 실제로 비UTC 세션임을 증명)
  assert.equal((await client.$queryRaw`SELECT count(*)::int n FROM schedule_slots WHERE ${where} AND scheduled_at=${at}`)[0].n,0);
  assert.equal((await client.$queryRaw`SELECT count(*)::int n FROM schedule_slots WHERE ${where} AND scheduled_at=${utcTimestamp(at)}`)[0].n,1);
  assert.equal((await client.$queryRaw`SELECT count(*)::int n FROM schedule_slots WHERE ${where} AND scheduled_at<${utcTimestamp(later)} AND scheduled_at>${utcTimestamp(new Date(at.getTime()-1))}`)[0].n,1);
  await client.$executeRaw`UPDATE schedule_slots SET scheduled_at=${utcTimestamp(later)} WHERE ${where}`;
  assert.equal((await client.scheduleSlot.findUnique({where:{id:slot.id}})).scheduledAt.toISOString(),later.toISOString());
  const future=await client.scheduleSlot.create({data:{ownerId:'o',channel:'facebook',scheduledAt:new Date(Date.now()+3600000)}});
  assert.equal((await client.$queryRaw`SELECT count(*)::int n FROM schedule_slots WHERE id=${future.id} AND scheduled_at<=${UTC_NOW}`)[0].n,0,'1시간 뒤 슬롯은 도래 아님');
  assert.equal((await client.$queryRaw`SELECT count(*)::int n FROM schedule_slots WHERE id=${future.id} AND scheduled_at<=now()`)[0].n,1,'양성 대조: 맨 now() 는 KST 세션에서 미래 슬롯을 도래로 오판');
 }finally{if(client)await client.$disconnect();if(server)await server.stop();await db.close();}
});
