/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, Request */
require("../../visibility/__tests__/register.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const owner = "clx12345678901234567890123",
  domainId = "clx12345678901234567890000",
  runKey = "123e4567-e89b-42d3-a456-426614174000";
let session = owner,
  calls = [],
  reads = 0;
require.cache[require.resolve("../../auth.ts")] = {
  exports: {
    requireSession: async () => {
      if (!session) throw new Error("Unauthorized");
      return { user: { id: session } };
    },
  },
};
require.cache[require.resolve("../audit.ts")] = {
  exports: {
    runAudit: async (...args) => {
      calls.push(args);
      return { data: { id: "audit", status: "pending" }, reused: false };
    },
    resumeAudit: async (...args) => {
      calls.push(args);
      return { id: "audit", status: "completed" };
    },
  },
};
require.cache[require.resolve("../data.ts")] = {
  exports: Object.fromEntries(
    ["listAudits", "listKeywords", "listRankings"].map((name) => [
      name,
      async () => {
        reads++;
        return { items: [], nextCursor: null };
      },
    ]),
  ),
};
const routes = ["audit", "keywords", "rankings"].map((name) =>
  require(`../../../app/api/seo/${name}/route.ts`),
);
const resume = require("../../../app/api/seo/audit/[id]/resume/route.ts");
const post = (route, body, headers = {}) =>
  route.POST(
    new Request("https://app.example/api/seo/audit", {
      method: "POST",
      body: JSON.stringify(body),
      headers,
    }),
  );
test("all seven SEO methods require a session and return the standard envelope", async () => {
  session = null;
  for (const route of routes) {
    assert.equal(
      (
        await route.GET(
          new Request("https://app.example/?domainId=" + domainId),
        )
      ).status,
      401,
    );
    assert.equal((await post(route, {})).status, 401);
  }
  assert.equal(
    (
      await resume.POST(
        new Request("https://app.example", { method: "POST", body: "{}" }),
        { params: Promise.resolve({ id: domainId }) },
      )
    ).status,
    401,
  );
  session = owner;
  assert.equal(calls.length, 0);
});
test("cross-site, duplicate filters, unknown keys, oversized bodies and invalid combinations are rejected before execution", async () => {
  for (const headers of [
    { origin: "https://evil.example" },
    { "sec-fetch-site": "cross-site" },
  ])
    assert.equal(
      (await post(routes[0], { domainId, runKey }, headers)).status,
      400,
    );
  assert.equal(
    (
      await routes[0].GET(
        new Request(
          `https://app.example/?domainId=${domainId}&domainId=${domainId}`,
        ),
      )
    ).status,
    400,
  );
  assert.equal(
    (await post(routes[0], { domainId, runKey, ownerId: owner })).status,
    400,
  );
  assert.equal(
    (await post(routes[1], { domainId, runKey, keywords: ["a".repeat(40000)] }))
      .status,
    400,
  );
  assert.equal(
    (
      await post(routes[2], {
        domainId,
        runKey,
        keywordIds: [],
        engines: ["google"],
      })
    ).status,
    400,
  );
  assert.equal(calls.length, 0);
});
test("GET methods return empty paginated responses and never execute or resume collection", async () => {
  for (const route of routes) {
    const response = await route.GET(
      new Request("https://app.example/?domainId=" + domainId),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      data: { items: [], nextCursor: null },
    });
  }
  assert.equal(reads, 3);
  assert.equal(calls.length, 0);
});
test("POST uses the proper scopes and pending 202; resume requires exactly an empty object", async () => {
  assert.equal((await post(routes[0], { domainId, runKey })).status, 202);
  assert.equal(
    (await post(routes[1], { domainId, runKey, keywords: ["SEO"] })).status,
    202,
  );
  assert.equal(
    (
      await post(routes[2], {
        domainId,
        runKey,
        keywordIds: [domainId],
        engines: ["google"],
      })
    ).status,
    202,
  );
  assert.deepEqual(
    calls.map((c) => c[2]),
    ["full", "research", "ranking"],
  );
  const context = { params: Promise.resolve({ id: domainId }) };
  assert.equal(
    (
      await resume.POST(
        new Request("https://app.example", {
          method: "POST",
          body: '{"cost":0}',
        }),
        context,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await resume.POST(
        new Request("https://app.example", { method: "POST", body: "{}" }),
        context,
      )
    ).status,
    200,
  );
  assert.equal(calls.at(-1)[0], owner);
  assert.equal(calls.at(-1)[1], domainId);
});
