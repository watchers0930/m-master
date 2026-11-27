/* eslint-disable @typescript-eslint/no-require-imports */
// processAudit: 이미 보낸 작업(결과 수거)을 먼저 집고, 새 제출이 예산·단가 검사로 거절돼도 수거는 끝낸 뒤 오류를 알린다(codex MED, 11-27).
require("../../visibility/__tests__/register.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
require.cache[require.resolve("../../auth.ts")] = { exports: {} };
const { VisibilityError } = require("../../visibility/http.ts");
let candidates, claimCalls, executed, budgetFails, synthesized;
const tx = {
  seoAudit: {
    findFirst: async () => ({ domainId: "domain", frozenConfig: {}, completedAt: null }),
    update: async () => ((synthesized += 1), {}),
  },
  seoTask: {
    count: async () => 0,
    findMany: async () => [{ status: "pending", costKrw: 0, resultCheckpoint: null, operation: "serp_google", failReason: null }],
    updateMany: async () => ({ count: 0 }),
  },
};
const prisma = {
  $transaction: async (fn) => fn(tx),
  // nextTasks는 수거(where.AND)와 제출(where.vendorTaskId === null)을 따로 조회한다
  seoTask: {
    findMany: async ({ where }) =>
      candidates.filter((c) => (where.vendorTaskId === null ? !c.vendorTaskId : !!c.vendorTaskId)).map(({ id }) => ({ id })),
  },
};
require.cache[require.resolve("../../prisma.ts")] = { exports: { prisma } };
require.cache[require.resolve("../../visibility/queries.ts")] = { exports: { lockOwner: async () => "pro" } };
require.cache[require.resolve("../tasks.ts")] = {
  exports: {
    claimTasks: async (_owner, ids) => {
      claimCalls.push(ids);
      if (budgetFails && ids.some((id) => id.startsWith("unsent"))) throw new VisibilityError("rate_limited", "예산 초과", 429);
      return ids.map((id) => ({ id }));
    },
  },
};
require.cache[require.resolve("../execute.ts")] = { exports: { executeTask: async (task) => executed.push(task.id) } };
require.cache[require.resolve("../metric-scheduling.ts")] = { exports: { scheduleMetricTasks: async () => {} } };
require.cache[require.resolve("../automatic-rankings.ts")] = { exports: { scheduleAutomaticRankings: async () => {} } };
require.cache[require.resolve("../reservations.ts")] = {
  exports: { expireAbandonedAudit: async () => {}, releaseKeywordReservations: async () => {} },
};
require.cache[require.resolve("../pending.ts")] = { exports: { recoverExpired: async () => {} } };
require.cache[require.resolve("../data.ts")] = { exports: { getAudit: async () => ({}) } };
const audit = require("../audit.ts");
function setup(list, fails) {
  candidates = list;
  claimCalls = [];
  executed = [];
  budgetFails = fails;
  synthesized = 0;
}
test("예산 거절이 나도 이미 보낸 작업의 결과는 먼저 받고 오류를 알린다", async () => {
  setup([{ id: "unsent-1", vendorTaskId: null }, { id: "sent-1", vendorTaskId: "v1" }], true);
  await assert.rejects(audit.processAudit("owner", "audit"), /예산/);
  assert.deepEqual(claimCalls, [["sent-1"], ["unsent-1"]]);
  assert.deepEqual(executed, ["sent-1"]);
  assert.ok(synthesized >= 1, "받은 결과를 진단 상태에 반영한 뒤 오류를 알린다");
});
test("보낼 작업만 있고 거절되면 그대로 오류(이전과 같음)", async () => {
  setup([{ id: "unsent-1", vendorTaskId: null }, { id: "unsent-2", vendorTaskId: null }], true);
  await assert.rejects(audit.processAudit("owner", "audit"), /예산/);
  assert.deepEqual(executed, []);
});
test("거절이 없으면 두 작업 모두 처리(수거 먼저 집고 제출을 이어서)", async () => {
  setup([{ id: "unsent-1", vendorTaskId: null }, { id: "sent-1", vendorTaskId: "v1" }], false);
  await audit.processAudit("owner", "audit");
  assert.deepEqual(claimCalls, [["sent-1"], ["unsent-1"]]);
  assert.deepEqual(executed.sort(), ["sent-1", "unsent-1"]);
});
