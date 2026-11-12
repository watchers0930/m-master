/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, __dirname */
// D1 재발 방지(소스 스캔): raw SQL 에서 timestamp(3) 컬럼을 맨 now()·Date 매개변수와 비교·대입하면 세션 TimeZone 에 따라
// 어긋난다(예약 슬롯 미도래 오발행·지연 결과 덮어쓰기). 반드시 lib/sql-time.ts 의 utcTimestamp()/UTC_NOW 를 쓴다.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../../..');
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
 const p=path.join(dir,e.name);
 if(e.isDirectory())return e.name==='__tests__'||e.name==='node_modules'?[]:walk(p);
 return /\.tsx?$/.test(e.name)?[p]:[];
});
/** 태그드 템플릿(raw SQL)의 골격: 리터럴은 그대로, ${expr} 는 ⟨expr⟩ 로. 중첩 템플릿도 펼친다. */
function skeletons(src){
 const out=[],tag=/(\$queryRaw(?:Unsafe)?(?:<[^`(]*>)?\(?\s*(?:Prisma\.)?sql|\$queryRaw(?:<[^`(]*>)?|\$executeRaw|Prisma\.sql)\s*`/g;
 const template=i=>{ // src[i] === '`'
  let s='';i++;
  while(i<src.length&&src[i]!=='`'){
   if(src[i]==='\\'){s+=src.slice(i,i+2);i+=2;continue;}
   if(src[i]==='$'&&src[i+1]==='{'){
    let depth=1,j=i+2,expr='';
    while(j<src.length&&depth){
     if(src[j]==='`'){const r=template(j);expr+='`'+r.s+'`';j=r.i+1;continue;}
     if(src[j]==='{')depth++;else if(src[j]==='}'){depth--;if(!depth)break;}
     expr+=src[j];j++;
    }
    s+='⟨'+expr.trim()+'⟩';i=j+1;continue;
   }
   s+=src[i];i++;
  }
  return {s,i};
 };
 let m;while((m=tag.exec(src))){const r=template(m.index+m[0].length-1);out.push({at:src.slice(0,m.index).split('\n').length,sql:r.s});tag.lastIndex=r.i+1;}
 return out;
}
const SAFE=/^(utcTimestamp\(|UTC_NOW$)/;
function violations(file,src){
 const v=[];
 for(const {at,sql} of skeletons(src)){
  if(/\bnow\(\)(?!\s*AT TIME ZONE)/i.test(sql)||/CURRENT_TIMESTAMP|LOCALTIMESTAMP/i.test(sql))v.push(`${file}:${at} 맨 now()`);
  for(const e of sql.matchAll(/AT\s+TIME\s+ZONE\s+(?!'UTC'(?![\w/+-]))(\S*)/gi))v.push(`${file}:${at} AT TIME ZONE 'UTC' 아님 ${e[1]}`);
  for(const e of sql.matchAll(/⟨(new Date\([^⟩]*)⟩/g))v.push(`${file}:${at} Date 직접 매개변수 ${e[1]}`);
  for(const e of sql.matchAll(/\b\w+_(?:at|until)\s*(?:<=|>=|<|>|=)\s*⟨([^⟩]*)⟩/g))if(!SAFE.test(e[1]))v.push(`${file}:${at} 시각 컬럼 비교·대입 ${e[0]}`);
 }
 return v;
}
test('raw SQL 은 timestamp 컬럼을 세션 TZ 무관 조각(utcTimestamp/UTC_NOW)으로만 비교·기록한다',()=>{
 const files=[...walk(path.join(root,'lib')),...walk(path.join(root,'app'))]; // lib/sql-time.ts 도 포함(AT TIME ZONE 'UTC' 고정 검사)
 const found=files.flatMap(f=>violations(path.relative(root,f),fs.readFileSync(f,'utf8')));
 assert.deepEqual(found,[]);
});
test('스캐너 자체 검증 — 위반 패턴은 잡고 안전 조각은 통과',()=>{
 const bad=[
  'tx.$queryRaw`SELECT 1 FROM s WHERE scheduled_at <= now() FOR UPDATE`',
  'tx.$executeRaw`UPDATE k SET updated_at = ${new Date()}`',
  'Prisma.sql`AND (old.created_at < ${audit.createdAt})`',
  'db.$queryRaw<X[]>(Prisma.sql`${base} AND ${q ? Prisma.sql`r.captured_at<=${to}` : Prisma.empty}`)',
  'prisma.$queryRaw`SELECT CURRENT_TIMESTAMP`',
 ];
 for(const src of bad)assert.equal(violations('x.ts',src).length>0,true,src);
 const good=[
  'tx.$queryRaw`SELECT 1 WHERE scheduled_at <= ${UTC_NOW} AND created_at > ${utcTimestamp(audit.createdAt)}`',
  'const n = now(); tx.$queryRaw`SELECT id FROM t WHERE id = ${id}`',
  'Prisma.sql`(now() AT TIME ZONE \'UTC\')`',
 ];
 for(const src of good)assert.deepEqual(violations('x.ts',src),[],src);
});
test("AT TIME ZONE 은 'UTC' 만 — 다른 시간대(예: Asia/Seoul)는 세션이 GMT 여도 9시간 어긋난다",()=>{
 for(const src of [
  "tx.$queryRaw`SELECT 1 WHERE scheduled_at <= (now() AT TIME ZONE 'Asia/Seoul')`",
  "Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'KST')`",
  "Prisma.sql`(created_at AT TIME ZONE ${tz})`",
  "Prisma.sql`(created_at at time zone 'Etc/GMT-9')`",
 ])assert.equal(violations('x.ts',src).some(v=>v.includes('AT TIME ZONE')),true,src);
 assert.deepEqual(violations('x.ts',"Prisma.sql`(now() AT TIME ZONE 'UTC')`"),[]);
 // 시간 조각 정의 파일 자체도 이 규칙으로 검사한다(UTC 가 아닌 값으로 바뀌면 잡힌다)
 const def=fs.readFileSync(path.join(root,'lib','sql-time.ts'),'utf8');
 assert.ok(/AT TIME ZONE 'UTC'/.test(def));
 assert.deepEqual(violations('lib/sql-time.ts',def),[]);
});
