/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, Request */
require("./register.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
let owner = "clx12345678901234567890123";
require.cache[require.resolve("../../auth.ts")] = {
  exports: {
    requireSession: async () => {
      if (!owner) throw new Error("Unauthorized");
      return { user: { id: owner } };
    },
  },
};
let count = 0,
  seen = [],
  locked = false;
const row = {
  id: "clx12345678901234567890000",
  query: "서비스 추천",
  domainId: null,
  market: "ko-KR",
  engines: ["chatgpt"],
  brandAliases: ["Vestra"],
  competitorAliases: [],
  frequency: "weekly",
  active: true,
  createdAt: new Date(),
  snapshots: [],
};
const db = {
  $queryRaw: async () => {
    locked = true;
    return [{ plan: "starter" }];
  },
  visibilityQuery: {
    count: async () => {
      assert.equal(locked, true);
      return count;
    },
    findFirst: async (args) => {
      seen.push(args);
      return null;
    },
    findMany: async (args) => {
      seen.push(args);
      return [];
    },
    deleteMany: async (args) => {
      seen.push(args);
      return { count: 0 };
    },
    create: async () => {
      count++;
      return row;
    },
  },
  domain: {
    findFirst: async (args) => {
      seen.push(args);
      return null;
    },
  },
  setting: { findUnique: async () => ({ defaultMarket: "ko-KR" }) },
  auditLog: { create: async () => ({}) },
};
let chain = Promise.resolve();
db.$transaction = (fn) => {
  const result = chain.then(async () => {
    try {
      return await fn(db);
    } finally {
      locked = false;
    }
  });
  chain = result.catch(() => {});
  return result;
};
require.cache[require.resolve("../../prisma.ts")] = { exports: { prisma: db } };
const queries = require("../../../app/api/visibility/queries/route.ts");
const item = require("../../../app/api/visibility/queries/[id]/route.ts");
const domains = require("../../../app/api/domains/route.ts");
let captureResults = [];
require.cache[require.resolve("../track.ts")] = {
  exports: { capture: async () => captureResults },
};
const snapshot = require("../../../app/api/visibility/snapshot/route.ts");
const { authenticated, jsonOk, queryParams } = require("../http.ts");
const createRequest = (body) =>
  new Request("https://app.example/api/visibility/queries", {
    method: "POST",
    body: JSON.stringify(body),
  });
const input = { query: "서비스 추천", brandAliases: ["Vestra"] };
test("all protected read/write routes map missing sessions to a 401 envelope", async () => {
  const prior = owner;
  owner = null;
  const responses = await Promise.all([
    queries.GET(new Request("https://app.example/api/visibility/queries")),
    queries.POST(createRequest(input)),
    domains.GET(new Request("https://app.example/api/domains")),
    snapshot.POST(createRequest({ queryId: row.id })),
  ]);
  for (const response of responses) {
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, "unauthorized");
  }
  owner = prior;
});
test("GET queries scopes every read to the authenticated owner and returns an empty array", async () => {
  const response = await queries.GET(
    new Request("https://app.example/api/visibility/queries?active=false"),
  );
  assert.deepEqual(await response.json(), { data: [], nextCursor: null });
  assert.equal(seen.at(-1).where.ownerId, owner);
  assert.equal(seen.at(-1).where.active, false);
});
test("PATCH and DELETE hide foreign IDs with 404 instead of 403", async () => {
  const context = { params: Promise.resolve({ id: row.id }) };
  const patch = await item.PATCH(
    new Request("https://app.example", {
      method: "PATCH",
      body: JSON.stringify({ active: false }),
    }),
    context,
  );
  const deletion = await item.DELETE(
    new Request("https://app.example", { method: "DELETE" }),
    context,
  );
  for (const response of [patch, deletion]) {
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, "not_found");
  }
  assert.equal(seen.at(-1).where.ownerId, owner);
});
test("foreign domain is rejected on query creation", async () => {
  count = 0;
  const response = await queries.POST(
    createRequest({ ...input, domainId: row.id }),
  );
  assert.equal(response.status, 404);
  assert.equal(seen.at(-1).where.ownerId, owner);
});
test("serialized creation rechecks the ten-record limit under the owner lock", async () => {
  count = 9;
  const responses = await Promise.all([
    queries.POST(createRequest(input)),
    queries.POST(createRequest(input)),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [201, 429]);
  assert.equal(count, 10);
  const denied = await responses.find((r) => r.status === 429).json();
  assert.equal(denied.error.code, "rate_limited");
});
test("forbidden fields, duplicate parameters and cross-origin writes fail safely", async () => {
  const invalid = await queries.POST(
    createRequest({ ...input, ownerId: owner }),
  );
  assert.equal(invalid.status, 400);
  const duplicate = await queries.GET(
    new Request("https://app.example/api/visibility/queries?limit=1&limit=100"),
  );
  assert.equal(duplicate.status, 400);
  const request = new Request("https://app.example/api/visibility/queries", {
    method: "POST",
    headers: { origin: "https://evil.example" },
    body: JSON.stringify(input),
  });
  assert.equal((await queries.POST(request)).status, 400);
  assert.throws(() =>
    queryParams(new Request("https://app.example?market=ko-KR&market=en-US")),
  );
});
test("unexpected failures never leak internal messages", async () => {
  const response = await authenticated(async () => {
    throw new Error("password=secret /internal/path");
  });
  assert.equal(response.status, 500);
  assert.equal(JSON.stringify(await response.json()).includes("secret"), false);
  assert.deepEqual(await jsonOk({ deleted: true }).json(), {
    data: { deleted: true },
  });
});

test("partial snapshot responses contain user messages and omit vendor/internal diagnostics", async () => {
  captureResults = [
    { engine: "chatgpt", status: "ok", snapshotId: "1" },
    { engine: "gemini", status: "failed", snapshotId: "2", failReason: "vendor_auth_failed" },
    { engine: "perplexity", status: "pending", snapshotId: "3", failReason: "capture_persistence_failed" },
  ];
  const response = await snapshot.POST(createRequest({ queryId: row.id }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(JSON.stringify(body).includes("vendor_auth_failed"), false);
  assert.equal(JSON.stringify(body).includes("capture_persistence_failed"), false);
  assert.equal(body.data.results[1].status, "failed");
  assert.equal(body.data.results[1].failReason, "일시적으로 수집 또는 판정을 완료하지 못했습니다.");
  assert.equal(body.data.results[2].status, "pending");
});
