/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, __dirname */
// 세션 TimeZone 고정(SET TIME ZONE)은 PGlite 를 만든 뒤 try 안에서 — 실패해도 finally 의 db.close() 가 반드시 돈다(적대 리뷰).
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const lib=path.resolve(__dirname,'../..');
function misplaced(src){
 const create=src.indexOf('PGlite.create(');
 const set=src.indexOf('SET TIME ZONE',create);
 if(create<0||set<0)return false;
 const tryAt=src.slice(create).search(/\btry\s*\{/);
 return tryAt<0||set<create+tryAt;
}
test('SET TIME ZONE 을 쓰는 DB 테스트는 try 안에서 실행한다',()=>{
 const files=fs.readdirSync(lib).flatMap(d=>{
  const dir=path.join(lib,d,'__tests__');
  return fs.existsSync(dir)?fs.readdirSync(dir).filter(f=>f.endsWith('.database.test.cjs')).map(f=>path.join(dir,f)):[];
 });
 const using=files.filter(f=>fs.readFileSync(f,'utf8').includes('SET TIME ZONE'));
 assert.ok(using.length>=3,'검사 대상 존재(backend·metrics·sql-time)');
 assert.deepEqual(using.filter(f=>misplaced(fs.readFileSync(f,'utf8'))).map(f=>path.relative(lib,f)),[]);
});
test('스캐너 자체 검증',()=>{
 assert.equal(misplaced('const db=await PGlite.create();\nawait db.exec("SET TIME ZONE \'Asia/Seoul\'");\ntry{ }finally{ await db.close(); }'),true);
 assert.equal(misplaced('const db=await PGlite.create();\ntry{\n await db.exec("SET TIME ZONE \'Asia/Seoul\'");\n}finally{ await db.close(); }'),false);
});
