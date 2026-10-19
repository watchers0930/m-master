// Disposable embedded PostgreSQL only; install @electric-sql/pglite separately or set PGLITE_MODULE.
process.env.TZ = "UTC";
require(process.cwd() + '/lib/visibility/__tests__/register.cjs');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async () => {
 const pg = new PGlite();
 await pg.exec('CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE contents(id TEXT); CREATE TABLE settings(id TEXT);');
 const ddl = fs.readFileSync('prisma/manual-migrations/20261019_minteq_visibility.sql','utf8');
 await pg.exec(ddl); await pg.exec(ddl);
 const db = { $queryRaw: async sql => (await pg.query(sql.text, sql.values.map(v => v instanceof Date ? v.toISOString() : v))).rows.map(row => {
  for (const key of ['latest','capturedAt']) if (typeof row[key] === 'string') row[key] = new Date(row[key].replace(' ','T')+'Z');
  return row;
 }) };
 require.cache[require.resolve(process.cwd()+'/lib/prisma.ts')] = { exports: { prisma: db } };
 const { visibilityData } = require(process.cwd()+'/lib/visibility/data.ts');
 const { dataSchema } = require(process.cwd()+'/schemas/visibility.ts');
 await pg.exec(`INSERT INTO users VALUES ('owner'),('foreign');
 INSERT INTO domains(id, owner_id, url) VALUES ('d','owner','new.example');
 INSERT INTO visibility_queries(id,owner_id,domain_id,query,market) VALUES ('q','owner','d','new','en-US'),('foreign','foreign',NULL,'foreign','ko-KR');
 INSERT INTO visibility_snapshots(id,query_id,engine,status,captured_at,capture_config,citations) VALUES
 ('a','q','chatgpt','ok','2026-10-19','{"market":"ko-KR","domain":"old.example","domainId":"old-d"}','[{"url":"https://old.example/a","position":1},{"url":"https://foreign.example","position":2}]'),
 ('b','q','chatgpt','pending','2026-10-19','{"market":"ko-KR"}','[]'),
 ('c','q','chatgpt','ok','2026-10-20','{"market":"ko-KR"}','[]'),
 ('x','foreign','chatgpt','ok','2026-10-19',NULL,'[]');
 INSERT INTO visibility_mentions(id,snapshot_id,subject,label,mentioned,cited,resolvable) VALUES
 ('m1','a','brand','brand',true,false,true),('m2','a','brand','brand2',false,false,true),
 ('m3','a','domain','old.example',false,true,true),('m4','a','competitor','rival',true,false,true),
 ('m5','c','brand','brand',true,false,false),('m6','c','domain','old.example',false,false,true);`);
 await pg.exec(ddl);
 assert.equal((await pg.query('SELECT count(*)::int AS n FROM visibility_snapshots')).rows[0].n,4);
 const filter = dataSchema.parse({ from:'2026-10-18',to:'2026-10-20',citationLimit:1 });
 const first = await visibilityData('owner',filter);
 assert.equal(first.engines[0].validSamples,1);
 assert.equal(first.engines[0].citationValidSamples,2);
 assert.equal(first.engines[0].unresolvableCount,2);
 assert.equal(first.engines[0].sov,1);
 assert.equal(first.engines[0].citationRate,0.5);
 assert.equal(first.citations.length,1);
 assert.equal(first.citations[0].isOwnDomain,true);
 assert.equal(first.competitors[0].mentionRate,1);
 assert.equal(first.trend.length,2);
 assert.ok(first.nextCitationCursor);
 const next = await visibilityData('owner', dataSchema.parse({ from:'2026-10-18',to:'2026-10-20',citationLimit:1,citationCursor:first.nextCitationCursor }));
 assert.equal(next.citations[0].url,'https://foreign.example');
 assert.equal(next.nextCitationCursor,null);
 const oldDomain = await visibilityData('owner', {...filter,domainId:'old-d'});
 assert.equal(oldDomain.totalValidSamples,1);
 console.log('PASS: additive DDL twice, frozen market/domain, owner isolation, DB aggregate denominators, trend, competitors, citation cursor');
 await pg.close();
})().catch(e => { console.error(e); process.exit(1); });
