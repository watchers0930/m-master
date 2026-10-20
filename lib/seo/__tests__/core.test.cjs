/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, Request */
require("../../visibility/__tests__/register.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
require.cache[require.resolve("../../auth.ts")] = {
  exports: { requireSession: async () => ({ user: { id: "owner" } }) },
};
const schemas = require("../../../schemas/seo.ts");
const { technicalChecks } = require("../checks.ts");
const { technicalScore } = require("../score.ts");
const { parseSerp, serpRequest } = require("../adapters/serp.ts");
const { parseKeywords } = require("../adapters/keywords.ts");
const { parseOnpage, onpageRequest } = require("../adapters/onpage.ts");
const { readJson, publicAddress } = require("../input.ts");
const { decodeCursor, encodeCursor } = require("../pagination.ts");
const { isOpportunity } = require("../keywords.ts");
const domainId = "clx12345678901234567890123",
  runKey = "123e4567-e89b-42d3-a456-426614174000";
const envelope = (items) => ({
  status_code: 20000,
  tasks: [{ status_code: 20000, result: [{ items }] }],
});
const input = {
  host: "example.com",
  market: "ko-KR",
  engine: "google",
  keyword: "seo",
};
test("strict API bodies reject trusted-field injection, duplicate engines, >10 combinations and malformed IDs", () => {
  const base = { domainId, runKey };
  assert.equal(schemas.auditSchema.parse(base).mode, "instant");
  for (const key of [
    "ownerId",
    "cost",
    "score",
    "rank",
    "pageCap",
    "taskId",
    "vendorTaskId",
  ])
    assert.throws(() => schemas.auditSchema.parse({ ...base, [key]: "x" }));
  assert.throws(() =>
    schemas.auditSchema.parse({ ...base, engines: ["google", "google"] }),
  );
  assert.throws(() =>
    schemas.rankingSchema.parse({
      ...base,
      keywordIds: Array.from(
        { length: 6 },
        (_, i) => `clx${String(i).padStart(22, "0")}`,
      ),
      engines: ["google", "naver"],
    }),
  );
  assert.throws(() => schemas.auditSchema.parse({ ...base, domainId: "x" }));
  assert.deepEqual(
    schemas.researchSchema.parse({
      ...base,
      keywords: [" ＳＥＯ ", "seo", "SEO"],
    }).keywords,
    ["SEO"],
  );
  assert.throws(() => schemas.resumeSchema.parse({ runKey }));
});
test("paths reject host replacement, encoded slashes, backslashes, fragments and excessive query strings", () => {
  for (const path of [
    "//evil.test",
    "/%2fhost",
    "/\\evil.test",
    "https://evil.test",
    "/x#hash",
    "/%00",
    "/?q=" + "a".repeat(600),
  ])
    assert.throws(() => schemas.pathSchema.parse(path));
  for (const path of ["/", "/valid?a=1", "/한국어"])
    assert.equal(schemas.pathSchema.parse(path), path);
});
test("streamed JSON limit counts bytes without trusting Content-Length", async () => {
  await assert.rejects(
    readJson(
      new Request("https://app.test", {
        method: "POST",
        body: JSON.stringify({ x: "가".repeat(12000) }),
      }),
    ),
    SyntaxError,
  );
  assert.deepEqual(
    await readJson(
      new Request("https://app.test", { method: "POST", body: "{}" }),
    ),
    {},
  );
});
test("SSRF blocks private, special-use and IPv4-mapped IPv6 addresses", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "100.64.1.1",
    "169.254.1.1",
    "172.16.0.1",
    "192.168.1.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "2002:7f00:1::",
  ])
    assert.equal(publicAddress(address), false, address);
  for (const address of ["8.8.8.8", "2606:4700:4700::1111"])
    assert.equal(publicAddress(address), true);
});
test("15 checks sum to 100, missing evidence is unknown, static HTML and per-page coefficients remain explicit", () => {
  const blank = technicalChecks([]);
  assert.equal(blank.checks.length, 15);
  assert.equal(
    blank.checks.reduce((n, c) => n + c.weight, 0),
    100,
  );
  assert.equal(technicalScore(blank.checks).technicalScore, null);
  const pages = parseOnpage(
    envelope([
      {
        url: "https://example.com",
        status_code: 200,
        meta: {
          title: "Appropriate title",
          description: "A".repeat(60),
          htags: { h1: ["Title"] },
        },
        checks: { no_image_alt: false },
      },
      {
        url: "https://example.com/a",
        status_code: 404,
        meta: {
          title: "Appropriate title",
          description: "",
          htags: { h1: [] },
        },
        checks: { no_image_alt: true },
      },
    ]),
  ).pages;
  const result = technicalChecks(pages);
  assert.equal(result.coefficients.http_access, 0.5);
  assert.equal(
    result.checks.find((c) => c.key === "title_quality").status,
    "warning",
  );
  assert.equal(
    result.checks.find((c) => c.key === "robots_allowed").status,
    "unknown",
  );
  assert.equal(
    result.checks.find((c) => c.key === "structured_data").status,
    "unknown",
  );
});
test("score contract gives 75/80%, excludes n/a and leaves no-evidence score null", () => {
  const check = (key, weight, status) => ({ key, weight, status });
  assert.deepEqual(
    technicalScore([
      check("a", 60, "pass"),
      check("b", 20, "fail"),
      check("c", 20, "unknown"),
    ]),
    { technicalScore: 75, coverage: 0.8, scoreVersion: "v1" },
  );
  assert.equal(
    technicalScore([check("a", 80, "pass"), check("b", 20, "not_applicable")])
      .coverage,
    1,
  );
});
test("SERP uses exact own host and organic rank, distinguishes no result and bounded absence", () => {
  const result = parseSerp(
    envelope([
      { type: "paid", url: "https://example.com", rank_group: 1 },
      { type: "organic", url: "https://example.com.evil.test", rank_group: 1 },
      { type: "organic", url: "https://www.example.com", rank_group: 2 },
      {
        type: "organic",
        url: "https://example.com/a",
        rank_group: 5,
        rank_absolute: 9,
      },
      {
        type: "organic",
        url: "https://example.com/b",
        rank_group: 3,
        rank_absolute: 7,
      },
    ]),
    input,
  ).observations[0];
  assert.equal(result.rank, 3);
  assert.equal(result.rankAbsolute, 7);
  assert.equal(result.returnedRange, 5);
  assert.equal(
    parseSerp(
      envelope([
        { type: "organic", url: "https://other.test", rank_group: 15 },
      ]),
      input,
    ).observations[0].status,
    "not_found_in_range",
  );
  assert.equal(
    parseSerp(envelope([]), input).observations[0].status,
    "no_result",
  );
  const naver = serpRequest({ ...input, engine: "naver" }).body[0];
  assert.equal(naver.location_code, undefined);
  assert.equal(naver.language_code, undefined);
  assert.equal(naver.max_crawl_pages, 1);
  assert.equal(serpRequest(input).body[0].depth, 100);
  assert.equal(
    onpageRequest("onpage_crawl", input).body[0].max_crawl_pages,
    20,
  );
});
test("volume null/zero/range and advertising index/period remain distinct; Labs rank is separate", () => {
  // Minimal documented field fixtures, not an account live-verification claim.
  // https://docs.dataforseo.com/v3/keywords_data/google_ads/keywords_for_site/live/
  const response = {
    status_code: 20000,
    tasks: [
      {
        status_code: 20000,
        result: [
          {
            keyword: "zero",
            search_volume: 0,
            competition: "MEDIUM",
            competition_index: 50,
            monthly_searches: [{ year: 2026, month: 9, search_volume: 0 }],
          },
          { keyword: "unknown" },
          { keyword: "range", search_volume: "100-1000" },
        ],
      },
    ],
  };
  const parsed = parseKeywords(response, "keywords_for_site", input);
  assert.equal(parsed.metrics[0].searchVolume, 0);
  assert.equal(parsed.metrics[0].competition, 0.5);
  assert.equal(parsed.metrics[0].competitionRaw, "MEDIUM");
  assert.equal(parsed.metrics[0].volumePeriod, "2026-09/2026-09");
  assert.equal(parsed.metrics[1].searchVolume, null);
  assert.equal(parsed.metrics[2].volumeScale, "100-1000");
  assert.equal(
    isOpportunity({ searchVolume: 100, rank: 15, rankStatus: "ranked" }),
    true,
  );
  assert.equal(
    isOpportunity({ searchVolume: 100, rank: null, rankStatus: null }),
    false,
  );
  assert.equal(
    isOpportunity({ searchVolume: 0, rank: 15, rankStatus: "ranked" }),
    false,
  );
});
test("pagination binds cursor to owner and complete filters and validates date ranges", () => {
  const filter = { ownerId: "a", domainId };
  const cursor = encodeCursor(new Date(), domainId, filter);
  assert.ok(decodeCursor(cursor, filter));
  assert.throws(() => decodeCursor(cursor, { ...filter, ownerId: "b" }));
  assert.throws(() => decodeCursor("invalid", filter));
  assert.throws(() =>
    schemas.rankingListSchema.parse({ domainId, from: "2026-02-30" }),
  );
  assert.throws(() =>
    schemas.rankingListSchema.parse({
      domainId,
      from: "2026-10-21",
      to: "2026-10-20",
    }),
  );
});
test("final vendor failure uses 502; partial, uncertain and idempotent reuse preserve report envelopes", () => {
  const { auditResponse } = require("../http.ts");
  const failed = {
    status: "failed",
    tasks: [{ status: "failed", failReason: "외부 수집에 실패했습니다." }],
  };
  assert.throws(
    () => auditResponse(failed),
    (e) => e.status === 502 && e.code === "external_failed",
  );
  assert.equal(auditResponse(failed, true).status, 200);
  assert.equal(auditResponse({ ...failed, status: "partial" }).status, 200);
  assert.equal(
    auditResponse({
      status: "failed",
      tasks: [{ status: "uncertain", failReason: "submission_uncertain" }],
    }).status,
    200,
  );
  assert.equal(auditResponse({ status: "pending", tasks: [] }).status, 202);
});

test("audit DTO exposes failed URL evidence without vendor identity or raw checkpoints", () => {
  const { auditDto } = require("../data.ts");
  const dto = auditDto({id:"audit",status:"partial",market:"ko-KR",scope:"technical",mode:"instant",checks:[],
    createdAt:new Date(),completedAt:new Date(),failReason:null,frozenConfig:{requestedPages:2},
    tasks:[{operation:"onpage_instant",status:"partial",itemKey:"-",failReason:"일부 URL 수집에 실패했습니다.",
      resultCheckpoint:{pageFailures:[{url:"https://example.com/b",reason:"vendor_failed",vendorStatus:40501}]}}]});
  assert.deepEqual(dto.tasks[0].failedUrls,["https://example.com/b"]);
  assert.equal("resultCheckpoint" in dto.tasks[0],false);
  assert.equal(JSON.stringify(dto).includes("40501"),false);
});
