/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require */
require("./register.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
let inspected,
  rows = [];
require.cache[require.resolve("../../prisma.ts")] = {
  exports: {
    prisma: {
      visibilityQuery: {
        findMany: async (args) => {
          inspected = args;
          return rows;
        },
      },
    },
  },
};
const { visibilityGapCandidates } = require("../../topics/visibility-gap.ts");
const { buildCandidates } = require("../../topics/candidates.ts");
const base = {
  id: "source-query",
  query: "AI 가시성 개선 방법",
  domainId: "domain",
  market: "ko-KR",
};
const sample = (
  engine,
  status = "ok",
  mentioned = false,
  resolvable = true,
) => ({
  engine,
  status,
  capturedAt: new Date("2026-10-19"),
  mentions: [
    { subject: "brand", label: "Vestra", mentioned, resolvable, cited: false },
    {
      subject: "domain",
      label: "vestra.example",
      mentioned: false,
      resolvable: true,
      cited: false,
    },
  ],
});
test("feedback excludes failed, no-result, unresolved and partially mentioned queries", async () => {
  rows = [
    { ...base, snapshots: [sample("chatgpt", "failed")] },
    { ...base, snapshots: [sample("chatgpt", "no_result")] },
    { ...base, snapshots: [sample("chatgpt", "ok", false, false)] },
    { ...base, snapshots: [sample("chatgpt"), sample("gemini", "ok", true)] },
  ];
  assert.deepEqual(await visibilityGapCandidates("owner"), []);
  assert.equal(inspected.where.ownerId, "owner");
  assert.equal(inspected.where.market, "ko-KR");
  assert.deepEqual(inspected.select.snapshots.distinct, ["engine"]);
});
test("valid absence is prioritized before the candidate cap with stable source evidence", async () => {
  rows = [
    {
      ...base,
      snapshots: [
        sample("chatgpt"),
        sample("gemini"),
        sample("ai_overviews", "no_result"),
      ],
    },
  ];
  const gaps = await visibilityGapCandidates("owner");
  assert.equal(gaps[0].factors.sourceQueryId, "source-query");
  assert.equal(gaps[0].factors.validEngineCount, 2);
  const candidates = buildCandidates({
    monthYmd: "2026-10-01",
    publishedTopics: [],
    visibilityGaps: gaps,
  });
  assert.equal(candidates[0].signal, "ai_visibility_gap");
  assert.equal(candidates[0].factors.market, "ko-KR");
  assert.equal(candidates.length <= 20, true);
  const published = buildCandidates({
    monthYmd: "2026-10-01",
    publishedTopics: [base.query],
    visibilityGaps: gaps,
  });
  assert.equal(
    published.some((c) => c.topic === base.query),
    false,
  );
});

test("domainless queries with valid brand absence produce visibility gap candidates", async () => {
  const snapshot = sample('chatgpt');
  snapshot.mentions[1].resolvable = false;
  snapshot.mentions[1].label = '';
  rows = [{ ...base, domainId: null, snapshots: [snapshot] }];
  const gaps = await visibilityGapCandidates('owner');
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].factors.domainId, null);
  assert.equal(gaps[0].factors.validEngineCount, 1);
  snapshot.mentions[0].mentioned = true;
  assert.deepEqual(await visibilityGapCandidates('owner'), []);
});
