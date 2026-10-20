/* eslint-disable @typescript-eslint/no-require-imports */
require("../../visibility/__tests__/register.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
require.cache[require.resolve("../../auth.ts")] = {
  exports: { requireSession: async () => ({ user: { id: "owner" } }) },
};
let rows, tx, failSecond;
require.cache[require.resolve("../../prisma.ts")] = {
  exports: {
    prisma: {
      $transaction: async (fn) => {
        const before = structuredClone(rows);
        try {
          return await fn(tx);
        } catch (e) {
          rows = before;
          throw e;
        }
      },
    },
  },
};
require.cache[require.resolve("../../visibility/queries.ts")] = {
  exports: { lockOwner: async () => "pro" },
};
require.cache[require.resolve("../../billing/limits.ts")] = {
  exports: { checkSeoFeature: () => {} },
};
require.cache[require.resolve("../budget.ts")] = {
  exports: {
    supported: () => true,
    estimate: () => 20,
    checkSeoBudget: async () => {
      if (failSecond && rows[0].status === "claimed")
        throw new Error("budget/pricing rejected");
    },
  },
};
require.cache[require.resolve("../../cost/tracker.ts")] = { exports: {} };
const {
  claimTasks,
  beginExecution,
  releaseClaim,
  taskResult,
} = require("../tasks.ts");
const { recoverExpired } = require("../pending.ts");
function matches(row, where) {
  return Object.entries(where).every(([key, value]) => {
    if (key === "audit") return true;
    if (key === "OR") return value.some((v) => matches(row, v));
    if (value && typeof value === "object") {
      if ("gt" in value) return row[key] > value.gt;
      if ("lte" in value) return row[key] !== null && row[key] <= value.lte;
      if ("in" in value) return value.in.includes(row[key]);
      if ("equals" in value) return row[key] === null;
    }
    return row[key] === value;
  });
}
function apply(row, data) {
  for (const [k, v] of Object.entries(data))
    row[k] =
      v && typeof v === "object" && "increment" in v ? row[k] + v.increment : v;
}
function setup() {
  failSecond = false;
  rows = ["a", "b"].map((id) => ({
    id,
    ownerId: "owner",
    auditId: "audit",
    status: "pending",
    claimVersion: 0,
    leaseUntil: null,
    reservedKrw: 10,
    vendorTaskId: null,
    resultCheckpoint: null,
    operation: "labs_ranked",
    frozenInput: { market: "ko-KR" },
  }));
  tx = {
    seoTask: {
      findFirst: async ({ where }) =>
        structuredClone(rows.find((r) => matches(r, where)) ?? null),
      count: async ({ where }) => rows.filter((r) => matches(r, where)).length,
      update: async ({ where, data }) =>
        apply(
          rows.find((r) => matches(r, where)),
          data,
        ),
      updateMany: async ({ where, data }) => {
        const found = rows.filter((r) => matches(r, where));
        found.forEach((r) => apply(r, data));
        return { count: found.length };
      },
    },
  };
}
test("second claim rejection rolls back all claims, leases and reserve increases before any submission", async () => {
  setup();
  failSecond = true;
  const before = structuredClone(rows);
  await assert.rejects(claimTasks("owner", ["a", "b"]), /rejected/);
  assert.deepEqual(rows, before);
});
test("expired unsubmitted claims release money and fence old workers; submitted loss remains uncertain", async () => {
  setup();
  const [claim] = await claimTasks("owner", ["a"]);
  rows[0].leaseUntil = new Date(0);
  rows[1].status = "submitted";
  await recoverExpired(tx, "owner", "audit");
  assert.equal(rows[0].status, "pending");
  assert.equal(rows[0].reservedKrw, 0);
  assert.equal(rows[0].leaseUntil, null);
  assert.equal(rows[1].status, "uncertain");
  await assert.rejects(beginExecution(claim), /소유권/);
});
test("only current claimed worker may cross submission boundary; preflight failure returns claim", async () => {
  setup();
  const [a, b] = await claimTasks("owner", ["a", "b"]);
  await releaseClaim(a);
  assert.equal(rows[0].status, "pending");
  assert.equal(rows[0].reservedKrw, 0);
  await assert.rejects(beginExecution(a), /소유권/);
  await beginExecution(b);
  assert.equal(rows[1].status, "submitted");
  await releaseClaim(b);
  assert.equal(rows[1].status, "submitted");
});

test("durable OnPage outcomes finalize as partial or failed, release all reserves and retain URL failures", async () => {
  const { checkpointSchema } = require("../adapters/types.ts");
  for (const hasPage of [true, false]) {
    setup();
    const [claim] = await claimTasks("owner", ["a"]);
    await beginExecution(claim);
    tx.seoAudit = {
      findUniqueOrThrow: async () => ({
        domainId: "domain",
        market: "ko-KR",
        runKey: "run",
      }),
    };
    const result = checkpointSchema.parse({
      pages: hasPage
        ? [
            {
              url: "https://example.com/a",
              status: 200,
              title: null,
              description: null,
              canonical: null,
              h1: null,
              checks: {},
            },
          ]
        : [],
      pageFailures: [
        {
          url: "https://example.com/b",
          reason: "vendor_failed",
          vendorStatus: 40501,
        },
      ],
    });
    await taskResult(claim, result);
    assert.equal(rows[0].status, hasPage ? "partial" : "failed");
    assert.equal(rows[0].reservedKrw, 0);
    assert.equal(rows[0].leaseUntil, null);
    assert.deepEqual(
      rows[0].resultCheckpoint.pageFailures,
      result.pageFailures,
    );
  }
});
