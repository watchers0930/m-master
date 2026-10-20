/* eslint-disable @typescript-eslint/no-require-imports */
require("../../visibility/__tests__/register.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
require.cache[require.resolve("../../auth.ts")] = { exports: {} };
let audit, tasks, reservations, budgetFails, scheduled, tx;
const prisma = {
  $transaction: async (fn) => fn(tx),
  seoTask: { findMany: async () => [] },
};
require.cache[require.resolve("../../prisma.ts")] = { exports: { prisma } };
require.cache[require.resolve("../../visibility/queries.ts")] = {
  exports: { lockOwner: async () => "pro" },
};
require.cache[require.resolve("../../billing/limits.ts")] = {
  exports: { checkSeoFeature: () => {} },
};
const { VisibilityError } = require("../../visibility/http.ts");
require.cache[require.resolve("../budget.ts")] = {
  exports: {
    checkSeoBudget: async () => {
      if (budgetFails) throw new VisibilityError("rate_limited", "budget", 429);
    },
  },
};
require.cache[require.resolve("../plan.ts")] = {
  exports: {
    rankPlans: async () => {
      scheduled++;
      reservations++;
      return [
        {
          operation: "serp_google",
          itemKey: "keyword:google",
          status: "pending",
          frozenInput: {},
          reservedKrw: 20,
        },
      ];
    },
    taskData: (t, ownerId, runKey) => ({ ...t, ownerId, runKey }),
  },
};
require.cache[require.resolve("../tasks.ts")] = {
  exports: { claimTasks: async () => [] },
};
require.cache[require.resolve("../execute.ts")] = { exports: {} };
require.cache[require.resolve("../input.ts")] = { exports: {} };
require.cache[require.resolve("../data.ts")] = {
  exports: { getAudit: async () => ({ ...audit }) },
};
const { resumeAudit } = require("../audit.ts");
const { expireAbandonedAudit } = require("../reservations.ts");
function setup() {
  budgetFails = true;
  scheduled = 0;
  reservations = 0;
  audit = {
    id: "audit",
    domainId: "domain",
    market: "ko-KR",
    runKey: "run",
    status: "pending",
    completedAt: null,
    frozenConfig: { autoRankings: true, engines: ["google"], scope: "full" },
  };
  tasks = [
    {
      operation: "labs_ranked",
      status: "completed",
      costKrw: 2,
      resultCheckpoint: null,
    },
  ];
  tx = {
    $executeRaw: async () => {
      reservations = 0;
    },
    seoAudit: {
      findFirst: async () => ({ ...audit, tasks }),
      update: async ({ data }) => Object.assign(audit, data),
    },
    seoKeyword: { findMany: async () => [{ id: "keyword" }] },
    seoTask: {
      count: async () => 0,
      findMany: async () => tasks,
      updateMany: async () => ({ count: 0 }),
      createMany: async ({ data }) => {
        tasks.push(...data);
      },
    },
  };
}
test("automatic budget rejection durably fails ranking, releases keyword capacity and finalizes base work as partial", async () => {
  setup();
  const result = await resumeAudit("owner", "audit");
  assert.equal(result.status, "partial");
  assert.ok(result.completedAt);
  assert.equal(result.frozenConfig.autoRankings, false);
  assert.equal(result.frozenConfig.autoRankingsState, "skipped");
  assert.equal(tasks[1].status, "failed");
  assert.equal(tasks[1].reservedKrw, 0);
  assert.equal(reservations, 0);
  budgetFails = false;
  await resumeAudit("owner", "audit");
  assert.equal(scheduled, 1);
  assert.equal(tasks.length, 2);
});
test("accepted automatic rankings stay pending until actual scheduled tasks finish", async () => {
  setup();
  budgetFails = false;
  const result = await resumeAudit("owner", "audit");
  assert.equal(result.status, "pending");
  assert.equal(result.completedAt, null);
  assert.equal(result.frozenConfig.autoRankingsState, "scheduled");
  assert.equal(tasks[1].status, "pending");
});
test("48h legacy automatic intent with no pending task can expire without blocking another audit or deletion", async () => {
  setup();
  tx.seoAudit.findFirst = async ({ where }) => {
    assert.equal(where.tasks.some, undefined);
    assert.equal(where.status, "pending");
    assert.ok(where.createdAt.lte < new Date());
    return { ...audit, tasks };
  };
  await expireAbandonedAudit(tx, "owner", "domain");
  assert.equal(audit.status, "partial");
  assert.ok(audit.completedAt);
  assert.equal(audit.frozenConfig.autoRankings, false);
  assert.equal(audit.frozenConfig.autoRankingsState, "expired");
});
