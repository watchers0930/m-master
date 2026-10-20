/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, Request */
require("../../visibility/__tests__/register.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const owner = "clx12345678901234567890123", domainId = "clx12345678901234567890000";
let session = owner, writes = 0, reads = 0, reused = false;
require.cache[require.resolve("../../auth.ts")] = { exports: { requireSession: async () => { if (!session) throw new Error("Unauthorized"); return { user: { id: session } }; } } };
require.cache[require.resolve("../generate.ts")] = { exports: { generateReport: async (id, input) => { writes++; assert.equal(id, owner); assert.equal(input.domainId, domainId); return { data: { status: "completed" }, reused }; } } };
require.cache[require.resolve("../data.ts")] = { exports: { getReports: async (id, input) => { reads++; assert.equal(id, owner); assert.equal(input.limit,20); return { items: [], nextCursor: null }; } } };
const route = require("../../../app/api/consulting/route.ts");
const post = (body, headers) => route.POST(new Request("https://app.test/api/consulting", { method: "POST", body: JSON.stringify(body), headers }));
test("API authenticates both methods, rejects CSRF, duplicate query, unknown fields, and oversized body", async () => {
  session = null;
  assert.equal((await post({})).status,401);
  assert.equal((await route.GET(new Request("https://app.test/?domainId="+domainId))).status,401);
  session = owner;
  for (const headers of [{ origin: "https://evil.test" }, { "sec-fetch-site": "cross-site" }]) assert.equal((await post({domainId},headers)).status,400);
  for (const body of [{domainId,ownerId:owner}, {domainId,market:"invalid"}, {domainId,extra:"a".repeat(40000)}]) assert.equal((await post(body)).status,400);
  for (const query of [`domainId=${domainId}&domainId=${domainId}`, `domainId=${domainId}&ownerId=${owner}`, `domainId=${domainId}&limit=101`])
    assert.equal((await route.GET(new Request("https://app.test/?"+query))).status,400);
  assert.equal(reads+writes,0);
});
test("API returns exact envelopes and new/reused status codes; GET performs no generation", async () => {
  assert.equal((await post({domainId})).status,201);
  reused = true;
  assert.equal((await post({domainId})).status,200);
  const before = writes;
  const res = await route.GET(new Request("https://app.test/?domainId="+domainId));
  assert.deepEqual(await res.json(), { data: {items:[],nextCursor:null} });
  assert.equal(writes,before);
});
