/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require */
require("../../visibility/__tests__/register.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const ACTIVE = ["pending", "claimed", "submitted"];

// 공유 인메모리 상태 — prisma·processAudit 목이 함께 조작한다.
let audits = [];
let tasks = [];
let processCalls = [];
let failAudit = null;

function active(t) {
  return ACTIVE.includes(t.status);
}
function collectable(t) {
  return active(t) && t.vendorTaskId && (!t.leaseUntil || t.leaseUntil <= Date.now());
}

require.cache[require.resolve("../../prisma.ts")] = {
  exports: {
    prisma: {
      seoAudit: {
        findMany: async ({ take }) => {
          const rows = audits
            .filter((a) => {
              if (a.status !== "pending") return false;
              const own = tasks.filter((t) => t.auditId === a.id);
              const someCollectable = own.some(collectable);
              // 활성 태스크 0 + autoRankings!=true 인 고아만 마감 대상.
              const noneActive = !own.some(active) && a.autoRankings !== true;
              return someCollectable || noneActive;
            })
            .sort((x, y) => x.createdAt - y.createdAt)
            .slice(0, take);
          return rows.map((a) => ({ id: a.id, domain: { ownerId: a.ownerId } }));
        },
      },
      seoTask: {
        count: async ({ where }) => {
          const statuses = where.status.in;
          const needEligible = Array.isArray(where.OR);
          const needVendor = where.vendorTaskId !== undefined;
          return tasks.filter(
            (t) =>
              t.auditId === where.auditId &&
              statuses.includes(t.status) &&
              (!needVendor || !!t.vendorTaskId) &&
              (!needEligible || !t.leaseUntil || t.leaseUntil <= Date.now()),
          ).length;
        },
      },
    },
  },
};

require.cache[require.resolve("../audit.ts")] = {
  exports: {
    // processAudit(collectOnly) 재현: vendorTaskId 있는 가장 오래된 2건만 수거 — ready면 completed.
    // 활성 태스크가 없으면 상태만 마감(여기선 조작 없음 = synthesize no-op).
    processAudit: async (ownerId, auditId, options = {}) => {
      processCalls.push({ ownerId, auditId, options });
      if (failAudit === auditId) throw new Error("boom");
      const pool = tasks.filter((t) => t.auditId === auditId && collectable(t));
      const picked = pool.sort((x, y) => x.order - y.order).slice(0, 2);
      for (const t of picked) {
        if (t.ready) t.status = "completed";
        t.leaseUntil = null;
      }
    },
  },
};

const { resumeBatch } = require("../resume-batch.ts");

function seed({ auditTasks, failOn = null, autoRankingsAudits = [] }) {
  audits = [];
  tasks = [];
  processCalls = [];
  failAudit = failOn;
  let order = 0;
  for (const [auditId, specs] of Object.entries(auditTasks)) {
    audits.push({
      id: auditId,
      ownerId: `owner-${auditId}`,
      status: "pending",
      createdAt: order,
      autoRankings: autoRankingsAudits.includes(auditId),
    });
    for (const spec of specs) {
      tasks.push({
        id: `${auditId}-${order}`,
        auditId,
        status: spec.status ?? "submitted",
        vendorTaskId: spec.vendorTaskId ?? (spec.status === "pending" ? null : "v-" + order),
        leaseUntil: null,
        ready: spec.ready ?? true,
        order: order++,
      });
    }
  }
}

function statuses(auditId) {
  return tasks.filter((t) => t.auditId === auditId).map((t) => t.status);
}

test("제출된(vendorTaskId) 태스크를 여러 패스로 모두 수거한다", async () => {
  seed({ auditTasks: { a: Array.from({ length: 8 }, () => ({ ready: true })) } });
  const result = await resumeBatch({ limit: 10, passes: 6 });
  assert.equal(result.scanned, 1);
  assert.equal(result.processed[0].collected, 8);
  assert.ok(statuses("a").every((s) => s === "completed"));
  assert.equal(result.processed[0].passes, 4); // 8건 / 2건 = 4패스
  // collectOnly로 호출됐는지
  assert.ok(processCalls.every((c) => c.options.collectOnly === true));
});

test("미제출 pending 태스크는 수거(과금) 대상이 아니다", async () => {
  seed({ auditTasks: { a: [{ status: "pending" }, { status: "pending" }] } });
  const result = await resumeBatch({ limit: 10, passes: 6 });
  // 활성 태스크(pending)는 있지만 vendorTaskId 없음 → some-collectable 아님, none-active도 아님 → 스캔 제외
  assert.equal(result.scanned, 0);
  assert.ok(statuses("a").every((s) => s === "pending"));
});

test("모든 태스크 종결됐는데 pending인 고아 감사를 마감 처리한다", async () => {
  // settled만 있고 활성 태스크 0 → none-active 조건으로 선택되어 processAudit(synthesize) 1회
  seed({ auditTasks: { a: [{ status: "completed" }, { status: "partial" }] } });
  const result = await resumeBatch({ limit: 10, passes: 6 });
  assert.equal(result.scanned, 1);
  assert.equal(result.processed[0].passes, 1);
  assert.equal(result.processed[0].collected, 0);
});

test("autoRankings 대기(활성0) 감사는 기아 유발하지 않게 스캔에서 제외한다", async () => {
  // 연구 완료 후 순위 미예약 구간: 활성 태스크 0 + autoRankings=true → synthesize가 pending 유지.
  seed({ auditTasks: { a: [{ status: "completed" }] }, autoRankingsAudits: ["a"] });
  const result = await resumeBatch({ limit: 10, passes: 6 });
  assert.equal(result.scanned, 0);
});

test("벤더 대기분만 남으면 무한 재시도 없이 1패스로 멈춘다", async () => {
  seed({ auditTasks: { a: Array.from({ length: 3 }, () => ({ ready: false })) } });
  const result = await resumeBatch({ limit: 10, passes: 6 });
  assert.equal(result.processed[0].collected, 0);
  assert.equal(result.processed[0].passes, 1);
  assert.ok(statuses("a").every((s) => s === "submitted"));
});

test("passes 상한을 넘지 않는다", async () => {
  seed({ auditTasks: { a: Array.from({ length: 20 }, () => ({ ready: true })) } });
  const result = await resumeBatch({ limit: 10, passes: 3 });
  assert.equal(result.processed[0].passes, 3);
  assert.equal(result.processed[0].collected, 6);
});

test("limit 만큼의 감사만 스캔한다", async () => {
  seed({
    auditTasks: { a: [{ ready: true }], b: [{ ready: true }], c: [{ ready: true }] },
  });
  const result = await resumeBatch({ limit: 2, passes: 6 });
  assert.equal(result.scanned, 2);
  assert.deepEqual(result.processed.map((p) => p.auditId), ["a", "b"]);
});

test("한 감사 실패가 배치 전체를 막지 않는다", async () => {
  seed({
    auditTasks: { a: [{ ready: true }, { ready: true }], b: [{ ready: true }] },
    failOn: "a",
  });
  const result = await resumeBatch({ limit: 10, passes: 6 });
  assert.equal(result.processed.find((p) => p.auditId === "a").error, true);
  assert.equal(result.processed.find((p) => p.auditId === "b").collected, 1);
  assert.ok(statuses("b").every((s) => s === "completed"));
});
