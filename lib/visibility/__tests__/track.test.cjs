/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require */
require("./register.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
require.cache[require.resolve("../../auth.ts")] = {
  exports: { requireSession: async () => ({ user: { id: "owner" } }) },
};
let rows = [],
  ledger = [],
  calls = [],
  failedEngine = null,
  spendFailure = false,
  queryCount = 1,
  detectedInputs = [],
  invalidateDuringDetect = false;
const query = {
  id: "query",
  ownerId: "owner",
  query: "test",
  active: true,
  engines: ["chatgpt", "gemini"],
  market: "ko-KR",
  frequency: "weekly",
  brandAliases: ["Vestra"],
  competitorAliases: [],
  domain: { url: "vestra.example" },
};
const db = {
  $queryRaw: async () => [{ plan: "starter" }],
  $transaction: async (fn) => fn(db),
  visibilityQuery: {
    findFirst: async ({ where }) => (where.ownerId === "owner" ? query : null),
    count: async () => queryCount,
  },
  setting: { findUnique: async () => ({ budgetMonthly: 100000 }) },
  costLedger: {
    aggregate: async () => {
      if (spendFailure) throw new Error("database unavailable");
      return { _sum: { krw: ledger.reduce((n, x) => n + x.krw, 0) } };
    },
    create: async ({ data }) => {
      ledger.push(data);
      return data;
    },
  },
  auditLog: { create: async () => ({}) },
  visibilitySnapshot: {
    findFirst: async ({ where }) =>
      rows.find(
        (r) =>
          r.queryId === where.queryId &&
          (!where.engine || r.engine === where.engine) &&
          (!where.status || r.status === where.status) &&
          (!where.capturedAt || r.capturedAt > where.capturedAt.gt),
      ) ?? null,
    findUnique: async ({ where }) =>
      rows.find(
        (r) =>
          r.engine === where.queryId_engine_runKey.engine &&
          r.runKey === where.queryId_engine_runKey.runKey,
      ) ?? null,
    count: async () => rows.filter((r) => r.status === "pending").length,
    create: async ({ data }) => {
      const row = {
        id: `snapshot-${rows.length}`,
        capturedAt: new Date(),
        ...data,
      };
      rows.push(row);
      return { ...row };
    },
    update: async ({ where, data }) => {
      const row = rows.find((r) => r.id === where.id && (!where.status || r.status === where.status));
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return { ...row };
    },
    updateMany: async ({ where, data }) => {
      const matched = rows.filter(r =>
        (!where.id || r.id === where.id) &&
        (!where.status || r.status === where.status) &&
        (!where.capturedAt?.lte || r.capturedAt <= where.capturedAt.lte) &&
        (!(where.capturedAt instanceof Date) || r.capturedAt.getTime() === where.capturedAt.getTime()) &&
        (where.taskId !== null || !r.taskId) &&
        (!where.rawJson || r.rawJson == null)
      );
      for (const row of matched) Object.assign(row, data);
      return { count: matched.length };
    },
  },
};
require.cache[require.resolve("../../prisma.ts")] = { exports: { prisma: db } };
const { DataForSeoError } = require("../../external/dataforseo.ts");
require.cache[require.resolve("../engines/index.ts")] = {
  exports: {
    getEngine: (engine) => ({
      source: "llm_scraper",
      supportsMarket: () => true,
      capture: async (_query, _market, context) => {
        calls.push({ engine, taskId: context.taskId, query: _query, market: _market });
        if (!context.taskId) await context.onTask("task-" + engine, 10);
        if (engine === failedEngine)
          throw new DataForSeoError("vendor_status_50000");
        return {
          engine,
          status: "ok",
          source: "llm_scraper",
          answerText: "Vestra service",
          citations: [],
          raw: {},
          costKrw: 10,
          taskId: context.taskId ?? "task-" + engine,
        };
      },
    }),
  },
};
require.cache[require.resolve("../detect.ts")] = {
  exports: { detect: async (input) => { detectedInputs.push(input); if (invalidateDuringDetect) rows.forEach(r => { r.status="failed"; r.failReason="query_configuration_changed"; }); return { mentions: [], failReason: undefined }; } },
};
const { capture } = require("../track.ts");
function reset() {
  rows = [];
  ledger = [];
  calls = [];
  failedEngine = null;
  spendFailure = false;
  queryCount = 1;
  detectedInputs = [];
  invalidateDuringDetect = false;
}
test("one failing engine does not stop another, and incurred costs are recorded for both", async () => {
  reset();
  failedEngine = "chatgpt";
  const results = await capture("owner", "query");
  assert.deepEqual(
    results.map((r) => r.status),
    ["failed", "ok"],
  );
  assert.equal(ledger.length, 2);
  assert.equal(
    ledger.reduce((n, r) => n + r.krw, 0),
    20,
  );
  assert.equal(
    ledger.every((r) => r.kind === "visibility"),
    true,
  );
});
test("scheduled replay skips an already claimed bucket without another paid call", async () => {
  reset();
  await capture("owner", "query");
  const count = calls.length;
  const replay = await capture("owner", "query");
  assert.deepEqual(replay, []);
  assert.equal(calls.length, count);
  assert.equal(ledger.length, 2);
});
test("known pending task resumes using its existing identity without charging submission twice", async () => {
  reset();
  rows.push({
    id: "pending",
    queryId: "query",
    engine: "chatgpt",
    status: "pending",
    capturedAt: new Date(Date.now() - 600000),
    taskId: "already-paid",
    costKrw: 10,
    rawJson: null,
  });
  await capture("owner", "query", ["chatgpt"]);
  assert.equal(calls[0].taskId, "already-paid");
  assert.equal(ledger.length, 0);
});
test("expired uncertain submission is failed and releases its reserve without replaying its run", async () => {
  reset();
  rows.push({
    id: "unknown",
    runKey: require("../run-key.ts").runKey("query", "chatgpt", "weekly"),
    queryId: "query",
    engine: "chatgpt",
    status: "pending",
    capturedAt: new Date(Date.now() - 600000),
    rawJson: null,
  });
  assert.deepEqual(await capture("owner", "query", ["chatgpt"]), []);
  assert.equal(calls.length, 0);
  assert.equal(rows[0].status, "failed");
  assert.equal(rows[0].failReason, "submission_unrecoverable");
  assert.equal(await db.visibilitySnapshot.count(), 0);
});
test("cost lookup failures and downgrade overages block paid work", async () => {
  reset();
  spendFailure = true;
  await assert.rejects(
    capture("owner", "query"),
    (error) => error.code === "rate_limited",
  );
  assert.equal(calls.length, 0);
  reset();
  queryCount = 11;
  await assert.rejects(
    capture("owner", "query"),
    (error) => error.code === "rate_limited",
  );
  assert.equal(calls.length, 0);
});
test("immediate interval blocks consecutive captures", async () => {
  reset();
  await capture("owner", "query", ["chatgpt"], { immediate: true });
  await assert.rejects(
    capture("owner", "query", ["chatgpt"], { immediate: true }),
    (error) => error.code === "rate_limited",
  );
  assert.equal(calls.length, 1);
});

test("budget checks release stale unknown reserves across queries before admitting new work", async () => {
  reset();
  rows.push({ id: 'old', queryId: 'another-query', engine: 'gemini', status: 'pending', taskId: null, rawJson: null, capturedAt: new Date(Date.now() - 600000) });
  const { checkCaptureBudget } = require('../budget.ts');
  await checkCaptureBudget(db, 'owner', { plan: 'starter', budgetMonthly: 1000, queryCount: 1 });
  assert.equal(rows[0].status, 'failed');
  assert.equal(calls.length, 0);
  rows.push({ id: 'active', status: 'pending', taskId: null, rawJson: null, capturedAt: new Date() });
  await assert.rejects(checkCaptureBudget(db, 'owner', { plan: 'starter', budgetMonthly: 1000, queryCount: 1 }), error => error.code === 'rate_limited');
  assert.equal(rows[1].status, 'pending');
});
test("normalized checkpoints resume without another vendor submission", async () => {
  reset();
  rows.push({
    id: 'saved', queryId: 'query', engine: 'chatgpt', status: 'pending', taskId: null, costKrw: 10,
    capturedAt: new Date(Date.now() - 600000),
    rawJson: { answerText: 'Vestra service', citations: [], source: 'llm_scraper', status: 'ok' },
  });
  const results = await capture('owner', 'query', ['chatgpt']);
  assert.equal(results[0].status, 'ok');
  assert.equal(rows[0].status, 'ok');
  assert.equal(calls.length, 0);
  assert.equal(ledger.length, 0);
});

test("resumed task uses frozen query, market, brand and domain instead of PATCHed input", async () => {
  reset();
  rows.push({ id: 'frozen', queryId: 'query', engine: 'chatgpt', status: 'pending', taskId: 'paid',
    capturedAt: new Date(Date.now()-600000), captureConfig: { query: 'original', market: 'en-US',
      brandAliases: ['Original'], competitorAliases: ['Rival'], domain: 'original.example' } });
  await capture('owner','query',['chatgpt']);
  assert.equal(calls[0].query,'original');
  assert.equal(calls[0].market,'en-US');
  assert.deepEqual(detectedInputs[0].brandAliases,['Original']);
  assert.deepEqual(detectedInputs[0].competitorAliases,['Rival']);
  assert.equal(detectedInputs[0].domain,'original.example');
});
test("paid pending for an engine removed from the query is still recovered", async () => {
  reset();
  rows.push({ id: 'removed', queryId: 'query', engine: 'perplexity', status: 'pending', taskId: 'paid-removed', capturedAt: new Date(Date.now()-600000) });
  await capture('owner','query',['chatgpt']);
  assert.ok(calls.some(c => c.engine === 'perplexity' && c.taskId === 'paid-removed'));
  assert.equal(rows.find(r => r.id==='removed').status,'ok');
});

test("removed paid task recovers even when budget blocks every new submission", async () => {
  reset(); spendFailure=true;
  rows.push({ id:'paid-blocked', queryId:'query', engine:'perplexity', status:'pending', taskId:'paid', capturedAt:new Date(Date.now()-600000) });
  const results=await capture('owner','query');
  assert.equal(results.length,1); assert.equal(results[0].status,'ok');
  assert.deepEqual(calls.map(c=>c.engine),['perplexity']);
});

test("completion cannot resurrect a pending snapshot invalidated during detection", async () => {
  reset(); invalidateDuringDetect=true;
  await capture('owner','query',['chatgpt']);
  assert.equal(rows[0].status,'failed');
  assert.equal(rows[0].failReason,'query_configuration_changed');
  assert.equal(rows[0].mentions,undefined);
});
