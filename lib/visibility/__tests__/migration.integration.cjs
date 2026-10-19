/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, __dirname */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
test("additive SQL preserves existing data, isolates domains and cascades only visibility records", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE users(id text primary key);
      CREATE TABLE contents(id text primary key, topic text);
      CREATE TABLE settings(id text primary key, owner_id text);
      CREATE TABLE cost_ledger(id text primary key, owner_id text, krw float);
      INSERT INTO users VALUES ('owner-a'), ('owner-b');
      INSERT INTO contents VALUES ('old-content','기존 콘텐츠');
      INSERT INTO settings VALUES ('old-setting','owner-a');`);
    const migration = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../prisma/manual-migrations/20261019_minteq_visibility.sql",
      ),
      "utf8",
    );
    await db.exec(migration);
    assert.deepEqual(
      (await db.query("SELECT topic,market FROM contents")).rows,
      [{ topic: "기존 콘텐츠", market: "ko-KR" }],
    );
    assert.equal(
      (await db.query("SELECT default_market FROM settings")).rows[0]
        .default_market,
      "ko-KR",
    );
    await db.exec(
      `INSERT INTO domains(id,owner_id,url) VALUES ('d-a','owner-a','vestra.example'),('d-b','owner-b','vestra.example');`,
    );
    await assert.rejects(
      db.exec(
        `INSERT INTO domains(id,owner_id,url) VALUES ('duplicate','owner-a','vestra.example')`,
      ),
    );
    await db.exec(`INSERT INTO visibility_queries(id,owner_id,domain_id,query,engines,brand_aliases,competitor_aliases)
      VALUES ('q-a','owner-a','d-a','query',ARRAY['chatgpt'],ARRAY['Vestra'],ARRAY[]::text[]);
      INSERT INTO visibility_snapshots(id,query_id,engine,run_key) VALUES ('s-a','q-a','chatgpt','weekly:2026-10-19');
      INSERT INTO visibility_mentions(id,snapshot_id,subject,label,mentioned,cited) VALUES ('m-a','s-a','brand','Vestra',true,false);
      INSERT INTO cost_ledger VALUES ('paid-cost','owner-a',50);`);
    await assert.rejects(
      db.exec(
        `INSERT INTO visibility_snapshots(id,query_id,engine,run_key) VALUES ('s-duplicate','q-a','chatgpt','weekly:2026-10-19')`,
      ),
    );
    await db.exec(
      `DELETE FROM visibility_queries WHERE id='q-a' AND owner_id='owner-b'`,
    );
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM visibility_queries"))
        .rows[0].n,
      1,
    );
    await db.exec(
      `DELETE FROM visibility_queries WHERE id='q-a' AND owner_id='owner-a'`,
    );
    for (const table of [
      "visibility_queries",
      "visibility_snapshots",
      "visibility_mentions",
    ])
      assert.equal(
        (await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n,
        0,
      );
    assert.equal(
      (await db.query("SELECT krw FROM cost_ledger")).rows[0].krw,
      50,
    );
    await db.exec(
      `UPDATE settings SET default_market='en-US' WHERE owner_id='owner-a'`,
    );
    assert.equal(
      (await db.query("SELECT market FROM contents")).rows[0].market,
      "ko-KR",
    );
  } finally {
    await db.close();
  }
});
