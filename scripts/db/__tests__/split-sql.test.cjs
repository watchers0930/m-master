/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require */
const {test}=require('node:test');
const assert=require('node:assert/strict');
test('SQL 분리: 주석·식별자·달러 인용 안의 ; 는 경계 아님',async()=>{
  const {splitSqlStatements}=await import('../split-sql.mjs');
  assert.deepEqual(splitSqlStatements('/* reason; detail */ SELECT 1; SELECT 2;'),['SELECT 1','SELECT 2']);
  assert.deepEqual(splitSqlStatements('CREATE TABLE "semi;colon" (id int);'),['CREATE TABLE "semi;colon" (id int)']);
  assert.deepEqual(splitSqlStatements('DO $v1$ BEGIN PERFORM 1; PERFORM 2; END $v1$;'),['DO $v1$ BEGIN PERFORM 1; PERFORM 2; END $v1$']);
  assert.deepEqual(splitSqlStatements("SELECT 'it''s;'; -- c;\nSELECT $$a;b$$;"),["SELECT 'it''s;'","SELECT $$a;b$$"]);
  assert.deepEqual(splitSqlStatements('/* a /* nested; */ b; */ SELECT 3'),['SELECT 3']);
});
