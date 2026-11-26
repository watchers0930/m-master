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
    createdAt: new Date(),
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
      findFirst: async ({ where }) =>
        where.createdAt?.lte && audit.createdAt > where.createdAt.lte ? null : { ...audit, tasks },
      update: async ({ data }) => Object.assign(audit, data),
    },
    seoKeyword: { findMany: async () => [{ id: "keyword", normalizedKeyword: "keyword" }] },
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

test("주제 키워드로 진단하면 이번 키워드 발견 결과만 후보로, 띄어쓰기 변형은 하나만 고른다", async () => {
  setup();
  budgetFails = false;
  audit.frozenConfig = { ...audit.frozenConfig, keywords: ["근저당확인"] };
  let keywordWhere;
  tx.seoTask.findFirst = async ({ where }) => {
    assert.equal(where.operation, "keywords_for_site");
    const metric = (keyword, searchVolume) => ({ keyword, engine: "google", searchVolume, volumeScale: null, volumePeriod: null, competition: 0.12, competitionRaw: "LOW" });
    return { resultCheckpoint: { metrics: [metric("근저당확인", 320), metric("근저당 확인", 320), metric("전세계약주의사항", 170)], observations: [] } };
  };
  tx.seoKeyword.findMany = async ({ where }) => {
    keywordWhere = where;
    return [
      { id: "a", normalizedKeyword: "근저당확인", searchVolume: 320 },
      { id: "b", normalizedKeyword: "근저당 확인", searchVolume: 320 },
      { id: "c", normalizedKeyword: "전세계약주의사항", searchVolume: 170 },
    ];
  };
  await resumeAudit("owner", "audit");
  assert.deepEqual(keywordWhere.normalizedKeyword, { in: ["근저당확인", "근저당 확인", "전세계약주의사항"] });
  assert.deepEqual(audit.frozenConfig.keywordIds, ["a", "c"]);
});
test("씨앗 결과가 없거나 깨졌으면 후보 없음(예전 Labs 키워드로 순위 비용을 쓰지 않음)", async () => {
  setup();
  budgetFails = false;
  audit.frozenConfig = { ...audit.frozenConfig, keywords: ["전세사기"] };
  let keywordWhere;
  tx.seoTask.findFirst = async () => ({ resultCheckpoint: null });
  tx.seoKeyword.findMany = async ({ where }) => ((keywordWhere = where), []);
  await resumeAudit("owner", "audit");
  assert.deepEqual(keywordWhere.normalizedKeyword, { in: [] });
});
test("씨앗이 없으면 지금처럼 이번 진단의 키워드 전체에서 고른다(범위 조건 없음)", async () => {
  setup();
  budgetFails = false;
  let keywordWhere;
  tx.seoTask.findFirst = async () => assert.fail("씨앗이 없으면 발견 결과를 읽지 않는다");
  let keywordOrder;
  tx.seoKeyword.findMany = async ({ where, orderBy }) => ((keywordWhere = where), (keywordOrder = orderBy), [{ id: "k", normalizedKeyword: "k", searchVolume: 1 }]);
  await resumeAudit("owner", "audit");
  assert.equal(keywordWhere.normalizedKeyword, undefined);
  // Postgres desc는 null이 먼저 — 검색량 모르는 키워드가 순위 비용을 먼저 가져가지 않게
  assert.deepEqual(keywordOrder[0], { searchVolume: { sort: "desc", nulls: "last" } });
  assert.deepEqual(audit.frozenConfig.keywordIds, ["k"]);
});
test("자동 순위 후보: 띄어쓰기 변형은 검색량 순 첫 번째만, 상한까지", () => {
  const { uniqueVariants: pickRankCandidates } = require("../seed-scope.ts");
  const rows = [["근저당확인", 320], ["근저당 확인", 320], ["전세 계약", 90], ["전세계약", 90], ["nowhere", 1000], ["now here", 10], ["모름", null], ["모 름", null]]
    .map(([normalizedKeyword, searchVolume], i) => ({ id: String(i), normalizedKeyword, searchVolume }));
  // 검색량이 같은 띄어쓰기 변형만 묶는다 — 검색량이 다르거나 모르면 다른 검색어로 둔다
  assert.deepEqual(pickRankCandidates(rows, 10).map((r) => r.id), ["0", "2", "4", "5", "6", "7"]);
  assert.deepEqual(pickRankCandidates(rows, 2).map((r) => r.id), ["0", "2"]);
});
