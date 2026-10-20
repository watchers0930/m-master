/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, __dirname, process, crypto */
/* Temporary in-memory PostgreSQL only. Requires PGLITE_SOCKET_PACKAGE pointing to an npm-cached package directory. */
require("../../visibility/__tests__/register.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createRequire } = require("node:module");
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;
if (!packageDir)
  throw new Error(
    "Set PGLITE_SOCKET_PACKAGE to an installed @electric-sql/pglite-socket package directory. Never use a production DB.",
  );
const runtimeRequire = createRequire(path.join(packageDir, "package.json"));
const { PGlite } = runtimeRequire("@electric-sql/pglite");
const { PGLiteSocketServer } = runtimeRequire("@electric-sql/pglite-socket");
const { PrismaClient } = require("@prisma/client");
const root = path.resolve(__dirname, "../../..");
let client, sessionOwner;
const queries = [];
const owner = "clx12345678901234567890123",
  foreign = "clx12345678901234567890124";
const transport = require("./vendor-fixtures.cjs").installVendorTransport();
require.cache[require.resolve("../../auth.ts")] = {
  exports: {
    requireSession: async () => {
      if (!sessionOwner) throw new Error("Unauthorized");
      return { user: { id: sessionOwner } };
    },
  },
};
test("temporary PostgreSQL migration and real Prisma SEO lifecycle", async (t) => {
  const db = await PGlite.create();
  let server;
  try {
    let schema = execFileSync(
      path.join(root, "node_modules/.bin/prisma"),
      [
        "migrate",
        "diff",
        "--from-empty",
        "--to-schema-datamodel",
        path.join(root, "prisma/schema.prisma"),
        "--script",
      ],
      { encoding: "utf8" },
    );
    // The unrelated legacy vector column is unused by these tests.
    schema = schema
      .replace(/CREATE EXTENSION[^;]*;/g, "")
      .replace(/vector\(1536\)/g, "TEXT");
    const baseline = schema
      .split(";")
      .filter(
        (s) =>
          !/(?:CREATE TABLE|CREATE (?:UNIQUE )?INDEX|ALTER TABLE) "seo_/.test(
            s,
          ),
      )
      .join(";");
    await db.exec(baseline);
    await db.exec(
      "INSERT INTO users(id,email,password_hash,updated_at,plan) VALUES ('" +
        owner +
        "','owner@example.test','unused',now(),'starter'),('" +
        foreign +
        "','foreign@example.test','unused',now(),'pro');",
    );
    const migration = fs.readFileSync(
      path.join(root, "prisma/manual-migrations/20261020_minteq_seo.sql"),
      "utf8",
    );
    await t.test(
      "SQL applies twice, preserves existing users and creates all 5 foreign keys",
      async () => {
        await db.exec(migration);
        await db.exec(migration);
        assert.equal(
          (await db.query("SELECT count(*)::int AS n FROM users")).rows[0].n,
          2,
        );
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int AS n FROM pg_constraint WHERE contype='f' AND conrelid IN ('seo_audits'::regclass,'seo_keywords'::regclass,'seo_rankings'::regclass,'seo_tasks'::regclass)",
            )
          ).rows[0].n,
          5,
        );
      },
    );
    server = new PGLiteSocketServer({ db, port: 0, host: "127.0.0.1" });
    await server.start();
    const connection = server.getServerConn();
    const address = connection.startsWith("postgres")
      ? connection
      : `postgresql://postgres:postgres@${connection}/postgres`;
    client = new PrismaClient({
      log: [{ emit: "event", level: "query" }],
      datasources: {
        db: {
          url:
            address +
            (address.includes("?") ? "&" : "?") +
            "connection_limit=1&sslmode=disable",
        },
      },
    });
    client.$on("query", (event) => queries.push(event.query));
    require.cache[require.resolve("../../prisma.ts")] = {
      exports: { prisma: client },
    };
    process.env.DATAFORSEO_LOGIN = "test";
    process.env.DATAFORSEO_PASSWORD = "test";
    process.env.SEO_VERIFIED_PRICING_JSON = JSON.stringify(
      Object.fromEntries(
        [
          "onpage_instant",
          "onpage_crawl",
          "labs_ranked",
          "keywords_for_site",
          "serp_google",
          "serp_naver",
        ].map((op) => [
          op,
          {
            usdPerUnit: 0.01,
            verifiedAt: new Date().toISOString(),
            markets: ["ko-KR", "en-US"],
          },
        ]),
      ),
    );
    sessionOwner = owner;
    await client.setting.create({
      data: { ownerId: owner, budgetMonthly: 100000 },
    });
    const domain = await client.domain.create({
      data: { ownerId: owner, url: "example.com" },
    });
    const other = await client.domain.create({
      data: { ownerId: foreign, url: "other.example.com" },
    });
    const { runAudit, resumeAudit } = require("../audit.ts");
    const { getAudit, listKeywords, listRankings } = require("../data.ts");
    const { deleteDomain } = require("../../visibility/domains.ts");
    const { rankingListSchema } = require("../../../schemas/seo.ts");
    const runKey = crypto.randomUUID();
    let id;
    await t.test(
      "parallel identical runKey charges once, records separate Labs/direct rankings, resumes existing work",
      async () => {
        const results = await Promise.all([
          runAudit(owner, { domainId: domain.id, runKey }, "full"),
          runAudit(owner, { domainId: domain.id, runKey }, "full"),
        ]);
        assert.equal(results[0].data.id, results[1].data.id);
        id = results[0].data.id;
        assert.equal(await client.seoAudit.count(), 1);
        assert.equal(transport.paidCalls, 2);
        assert.equal((await getAudit(owner, id)).status, "pending");
        await assert.rejects(
          deleteDomain(owner, domain.id),
          (e) => e.code === "conflict",
        );
        let report;
        for (let i = 0; i < 6; i++) {
          report = await resumeAudit(owner, id);
          if (report.status !== "pending") break;
        }
        assert.equal(report.status, "completed"); // Unsupported Naver volume is an intentional skip.
        assert.equal(
          report.tasks.find((t) => t.operation === "naver_volume").status,
          "skipped",
        );
        assert.equal(await client.seoAudit.count(), 1);
        const seoCalls = transport.paidCalls;
        await runAudit(owner, { domainId: domain.id, runKey }, "full");
        await resumeAudit(owner, id);
        assert.equal(transport.paidCalls, seoCalls);
        assert.equal(await client.costLedger.count(), 5);
        assert.equal(
          await client.seoRanking.count({ where: { source: "labs" } }),
          1,
        );
        assert.equal(
          await client.seoRanking.count({ where: { source: "serp" } }),
          2,
        );
        const keywords = await listKeywords(owner, {
          domainId: domain.id,
          limit: 100,
        });
        assert.equal(keywords.items.length, 2);
        assert.equal(
          keywords.items.find((k) => k.engine === "google").rank,
          15,
        );
        assert.equal(
          keywords.items.find((k) => k.engine === "google").searchVolume,
          100,
        );
        const rankings = await listRankings(
          owner,
          rankingListSchema.parse({ domainId: domain.id }),
        );
        assert.equal(rankings.items.length, 3);
        assert.equal(report.crawledPages, 1);
        assert.ok(report.coverage > 0 && report.coverage < 1);
        const serialized = JSON.stringify(report);
        for (const forbidden of [
          "vendorTaskId",
          "resultCheckpoint",
          "frozenInput",
          "frozenConfig",
          "configHash",
          "password",
        ])
          assert.equal(serialized.includes(forbidden), false, forbidden);
      },
    );
    await t.test(
      "foreign resource combinations return 404 and changed runKey input conflicts",
      async () => {
        await assert.rejects(getAudit(foreign, id), (e) => e.status === 404);
        await assert.rejects(
          getAudit(owner, id, other.id),
          (e) => e.status === 404,
        );
        await assert.rejects(
          runAudit(
            owner,
            { domainId: other.id, runKey: crypto.randomUUID() },
            "full",
          ),
          (e) => e.status === 404,
        );
        await assert.rejects(
          runAudit(
            owner,
            { domainId: domain.id, runKey, mode: "crawl" },
            "full",
          ),
          (e) => e.status === 409,
        );
        const keyword = await client.seoKeyword.findFirst({
          where: { domainId: domain.id },
        });
        await assert.rejects(
          listRankings(
            foreign,
            rankingListSchema.parse({
              domainId: other.id,
              keywordId: keyword.id,
            }),
          ),
          (e) => e.status === 404,
        );
      },
    );
    await t.test(
      "GEO+SEO reservations share the owner budget, including delayed unsettled charges",
      async () => {
        const {
          pendingReservedKrw,
          checkCaptureBudget,
        } = require("../../visibility/budget.ts");
        const { checkSeoBudget } = require("../budget.ts");
        const query = await client.visibilityQuery.create({
          data: {
            ownerId: owner,
            query: "seo",
            engines: ["gemini"],
            brandAliases: ["seo"],
            competitorAliases: [],
          },
        });
        await client.visibilitySnapshot.create({
          data: {
            queryId: query.id,
            engine: "gemini",
            runKey: "budget",
            source: "test",
            status: "pending",
          },
        });
        await client.seoTask.create({
          data: {
            auditId: id,
            ownerId: owner,
            operation: "budget_test",
            itemKey: "-",
            runKey,
            frozenInput: {},
            reservedKrw: 500,
            ledgerRecordedAt: new Date(),
          },
        });
        assert.equal(await pendingReservedKrw(client, owner), 1500);
        await client.setting.update({
          where: { ownerId: owner },
          data: { budgetMonthly: 1600 },
        });
        await assert.rejects(
          checkSeoBudget(client, owner, "starter", 200),
          (e) => e.status === 429,
        );
        await assert.rejects(
          checkCaptureBudget(
            client,
            owner,
            { plan: "starter", budgetMonthly: 1600, queryCount: 1 },
            200,
          ),
          (e) => e.status === 429,
        );
        await client.seoTask.deleteMany({
          where: { operation: "budget_test" },
        });
        await client.visibilitySnapshot.deleteMany({
          where: { queryId: query.id },
        });
        await client.setting.update({
          where: { ownerId: owner },
          data: { budgetMonthly: 100000 },
        });
      },
    );
    await t.test(
      "lease tokens reject stale workers; repeated billing checkpoint writes only the confirmed delta",
      async () => {
        const { claimTask, checkpointTask, markTask, beginExecution } = require("../tasks.ts");
        let task = await client.seoTask.create({
          data: {
            auditId: id,
            ownerId: owner,
            operation: "serp_google",
            itemKey: "lease-test",
            runKey,
            frozenInput: {
              host: "example.com",
              market: "ko-KR",
              engine: "google",
              keyword: "lease",
            },
            reservedKrw: 100,
          },
        });
        const first = await claimTask(owner, task.id);
        assert.ok(first);
        assert.equal(await claimTask(owner, task.id), null);
        await beginExecution(first);
        const before = await client.costLedger.count();
        await checkpointTask(first, "lease-vendor-id", 10);
        await checkpointTask(first, "lease-vendor-id", 10);
        await checkpointTask(first, "lease-vendor-id", 15);
        assert.equal(await client.costLedger.count(), before + 2);
        task = await client.seoTask.findUnique({ where: { id: task.id } });
        assert.equal(task.costKrw, 15);
        await client.seoTask.update({
          where: { id: task.id },
          data: { leaseUntil: new Date(Date.now() - 1000) },
        });
        const second = await claimTask(owner, task.id);
        assert.equal(second.claimVersion, first.claimVersion + 1);
        await beginExecution(second);
        await assert.rejects(
          checkpointTask(first, "lease-vendor-id", 20),
          (e) => e.code === "conflict",
        );
        await markTask(first, "failed", "stale");
        assert.equal(
          (await client.seoTask.findUnique({ where: { id: task.id } })).status,
          "submitted",
        );
        await markTask(second, "completed", "test complete");
        await client.seoTask.update({
          where: { id: task.id },
          data: { reservedKrw: 0 },
        });
      },
    );
    await t.test(
      "expired unknown submissions remain uncertain and retain their budget rather than submitting again",
      async () => {
        const { recoverExpired } = require("../pending.ts");
        const task = await client.seoTask.create({
          data: {
            auditId: id,
            ownerId: owner,
            operation: "serp_google",
            itemKey: "unknown",
            runKey,
            status: "submitted",
            frozenInput: {},
            reservedKrw: 200,
            leaseUntil: new Date(Date.now() - 1000),
          },
        });
        await recoverExpired(client, owner, id);
        const changed = await client.seoTask.findUnique({
          where: { id: task.id },
        });
        assert.equal(changed.status, "uncertain");
        assert.equal(changed.reservedKrw, 200);
        await assert.rejects(
          deleteDomain(owner, domain.id),
          (e) => e.status === 409,
        );
        await client.seoTask.update({
          where: { id: task.id },
          data: {
            status: "failed",
            reservedKrw: 0,
            ledgerRecordedAt: new Date(),
          },
        });
      },
    );
    await require("./regression-database.cjs").regressionChecks(t, client, { owner });
    await require("./review-database.cjs").reviewChecks(t, client, {
      owner,
      queries,
      db,
    });
    await require("./database-checks.cjs").additionalChecks(t, client, {
      owner,
      domain,
      id,
      queries,
    });
    await t.test(
      "owner deletes completed SEO history via cascade while the confirmed ledger survives",
      async () => {
        const before = await client.costLedger.count({
          where: { ownerId: owner },
        });
        await deleteDomain(owner, domain.id);
        assert.equal(await client.seoAudit.count(), 0);
        assert.equal(await client.seoKeyword.count(), 0);
        assert.equal(await client.seoRanking.count(), 0);
        assert.equal(await client.seoTask.count(), 0);
        assert.equal(
          await client.costLedger.count({ where: { ownerId: owner } }),
          before,
        );
      },
    );
  } finally {
    if (client) await client.$disconnect();
    if (server) await server.stop();
    await db.close();
  }
});
