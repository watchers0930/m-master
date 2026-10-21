/* eslint-disable @typescript-eslint/no-require-imports */
require("../../visibility/__tests__/register.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
require.cache[require.resolve("../../auth.ts")] = { exports: {} };
let audit, tasks;
const tx = {
  $executeRaw: async () => 0,
  $queryRaw: async (query) => query.strings.join("").includes("count(*)") ? [{ total: 0 }] : [],
  seoAudit: {
    findFirst: async ({ where }) => {
      if (where.status === "completed") {
        assert.equal(where.scope, "full");
        assert.equal(where.domain.ownerId, "owner");
        return audit.status === "completed" ? audit : null;
      }
      // expireAbandonedAudit 조회(만료 컷오프)는 이 스위트 범위 밖 → 해당 없음으로 no-op.
      if (where.createdAt?.lte) return null;
      return audit;
    },
    update: async ({ data }) => Object.assign(audit, data),
  },
  seoTask: {
    findMany: async () => tasks,
    updateMany: async () => ({ count: 0 }),
  },
  seoKeyword: { findMany: async () => [], count: async () => 0 },
};
const prisma = {
  $transaction: async (fn) => fn(tx),
  seoTask: { findMany: async () => [] },
};
require.cache[require.resolve("../../prisma.ts")] = { exports: { prisma } };
require.cache[require.resolve("../../visibility/queries.ts")] = {
  exports: { lockOwner: async () => "pro" },
};
require.cache[require.resolve("../tasks.ts")] = { exports: { claimTasks: async () => [] } };
require.cache[require.resolve("../execute.ts")] = { exports: {} };
require.cache[require.resolve("../data.ts")] = { exports: { getAudit: async () => ({ ...audit }) } };
require.cache[require.resolve("../../visibility/data.ts")] = {
  exports: { visibilityData: async () => ({ engines: [], citations: [], competitors: [] }) },
};
require.cache[require.resolve("../../consulting/stored-ga4.ts")] = {
  exports: { readStoredGa4: async () => ({ status: "missing", reason: null }) },
};
const { taskPlan, buildPlans } = require("../plan.ts");
const { resumeAudit } = require("../audit.ts");
const { collectInput } = require("../../consulting/input.ts");
const { validateStrategy } = require("../../consulting/validate.ts");
const { strategy } = require("../../consulting/__tests__/fixtures.cjs");
function setup() {
  audit = {
    id: "audit", status: "pending", completedAt: null,
    createdAt: new Date("2026-10-19T10:00:00Z"),
    frozenConfig: { autoRankings: false, scope: "full", engines: ["google"] },
  };
  tasks = [{
    operation: "onpage_instant", status: "completed", costKrw: 1,
    resultCheckpoint: {
      pages: [{ url: "https://example.com", status: 200, title: "Example title",
        description: "Example description", canonical: "https://example.com", h1: ["Example"], checks: {} }],
    },
  }, { ...taskPlan("naver_volume", "-", { host: "example.com", market: "ko-KR" }), costKrw: 0 }];
}
test("unsupported plans are skipped without pricing or reservations", async () => {
  const previous = process.env.SEO_VERIFIED_PRICING_JSON;
  process.env.SEO_VERIFIED_PRICING_JSON = "{}";
  try {
    const plans = await buildPlans(tx, "owner", {
      domainId: "domain", host: "example.com", market: "ko-KR", scope: "full",
      engines: ["google", "naver"], autoRankings: false,
    }, "pro");
    assert.equal(plans.length, 4);
    assert.ok(plans.every(t => t.status === "skipped" && t.reservedKrw === 0));
  } finally {
    if (previous === undefined) delete process.env.SEO_VERIFIED_PRICING_JSON;
    else process.env.SEO_VERIFIED_PRICING_JSON = previous;
  }
});
test("completed collection plus unsupported skips completes the full audit and supplies SEO-only consulting evidence", async () => {
  setup();
  const result = await resumeAudit("owner", "audit");
  assert.equal(tasks[1].status, "skipped");
  assert.equal(result.status, "completed");
  assert.equal(result.failReason, null);
  assert.ok(result.completedAt);
  assert.ok(result.technicalScore > 0);
  assert.ok(result.coverage > 0);
  // Consulting reads completed UTC days, so collect on the day after this audit.
  const now = new Date(result.completedAt);
  now.setUTCDate(now.getUTCDate() + 1);
  const snapshot = await collectInput("owner", {
    id: "clx12345678901234567890000", market: "ko-KR", url: "example.com",
  }, { amount: 101, currency: "KRW" }, now);
  assert.equal(snapshot.sourceStatus.find(s => s.source === "seo").status, "partial");
  assert.ok(snapshot.sourceStatus.filter(s => s.source !== "seo").every(s => s.status === "missing"));
  assert.equal(snapshot.evidence.find(e => e.id === "seo_tech_score").value, result.technicalScore);
  assert.equal(snapshot.evidence.find(e => e.id === "seo_coverage").value, result.coverage);
  const value = strategy();
  value.diagnosis.summary = "현재 점수 {{ev:seo_tech_score}}";
  for (const item of [...value.channelMix, ...value.priorityActions]) item.evidenceIds = ["seo_tech_score"];
  assert.doesNotThrow(() => validateStrategy(value, snapshot));
});
test("genuine failures, partial results and pending work retain their audit meanings alongside unsupported skips", async () => {
  for (const [taskStatus, expected] of [["failed", "partial"], ["partial", "partial"], ["uncertain", "partial"], ["pending", "pending"]]) {
    setup();
    tasks.push({ operation: "labs_ranked", status: taskStatus, costKrw: 0 });
    assert.equal((await resumeAudit("owner", "audit")).status, expected);
  }
  setup();
  tasks[0].status = "failed";
  assert.equal((await resumeAudit("owner", "audit")).status, "failed");
});
test("legacy policy skips and expired automatic collection still represent incomplete audits", async () => {
  for (const state of ["skipped", "expired"]) {
    setup();
    audit.frozenConfig.autoRankingsState = state;
    tasks.push({ operation: "automatic_rankings", status: "skipped", costKrw: 0 });
    assert.equal((await resumeAudit("owner", "audit")).status, "partial");
  }
});
