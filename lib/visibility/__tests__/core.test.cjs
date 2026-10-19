/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process, Request, Response */
require("./register.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeHost, citationHost } = require("../normalize.ts");
const schemas = require("../../../schemas/visibility.ts");
const { score } = require("../score.ts");
const { normalizeVendor } = require("../engines/parse.ts");
const { runKey, periodBucket } = require("../run-key.ts");
const { DataForSeoClient } = require("../../external/dataforseo.ts");
const { verifyCronSecret } = require("../../cron/auth.ts");
const uid = "clx12345678901234567890123";
const valid = {
  query: "  어떤 서비스인가요?  ",
  brandAliases: ["Vestra"],
  domainId: uid,
};
const filters = {
  market: "ko-KR",
  from: "2026-10-01",
  to: "2026-10-19",
  queryId: null,
  domainId: null,
};
const mentions = [
  {
    subject: "brand",
    label: "Vestra",
    mentioned: true,
    cited: false,
    resolvable: true,
  },
  {
    subject: "domain",
    label: "vestra.example",
    mentioned: false,
    cited: true,
    resolvable: true,
  },
];
const snapshot = {
  engine: "chatgpt",
  status: "ok",
  capturedAt: new Date("2026-10-19T01:00:00Z"),
  citations: [],
  domain: "vestra.example",
  mentions,
};
function envelope(result, code = 20000, cost = 0) {
  return {
    status_code: 20000,
    cost,
    tasks: [
      {
        id: "vendor-task",
        status_code: code,
        result: result ? [result] : null,
      },
    ],
  };
}

test("host identity normalizes IDNs and rejects spoofed citation hosts", () => {
  assert.equal(
    normalizeHost("HTTPS://WWW.Example.COM.:443/a?q=1"),
    "www.example.com",
  );
  assert.equal(
    normalizeHost("https://도메인.한국/path"),
    normalizeHost("도메인.한국"),
  );
  assert.notEqual(
    citationHost("https://vestra.example.evil.example"),
    "vestra.example",
  );
  assert.notEqual(
    normalizeHost("www.vestra.example"),
    normalizeHost("vestra.example"),
  );
  for (const input of [
    "javascript:alert(1)",
    "https://user:pass@example.com",
    "127.0.0.1",
    "bad_host.example",
    "localhost",
  ])
    assert.throws(() => normalizeHost(input));
  assert.equal(citationHost("javascript:alert(1)"), null);
});
test("query contract trims input and rejects forbidden, duplicate and invalid fields", () => {
  assert.equal(
    schemas.queryCreateSchema.parse(valid).query,
    "어떤 서비스인가요?",
  );
  for (const body of [
    { ...valid, query: " " },
    { ...valid, ownerId: uid },
    { ...valid, engines: ["chatgpt", "chatgpt"] },
    { ...valid, market: "fr-FR" },
    { ...valid, domainId: "550e8400-e29b-41d4-a716-446655440000" },
    { ...valid, brandAliases: [] },
    { ...valid, brandAliases: ["a".repeat(101)] },
    { ...valid, query: "x".repeat(1001) },
  ])
    assert.equal(schemas.queryCreateSchema.safeParse(body).success, false);
  for (const body of [
    {},
    { ownerId: uid },
    { frequency: "monthly" },
    { createdAt: "now" },
  ])
    assert.equal(schemas.queryPatchSchema.safeParse(body).success, false);
  assert.equal(
    schemas.queryPatchSchema.safeParse({ active: false }).success,
    true,
  );
});
test("filter validation rejects invalid booleans, limits and date ranges", () => {
  assert.equal(
    schemas.queryListSchema.parse({ active: "false" }).active,
    false,
  );
  for (const limit of ["0", "101", "2.5", "NaN"])
    assert.equal(schemas.queryListSchema.safeParse({ limit }).success, false);
  assert.equal(
    schemas.queryListSchema.safeParse({ active: "yes" }).success,
    false,
  );
  for (const input of [
    { from: "2026-02-30" },
    { from: "2025-01-01", to: "2026-10-19" },
    { from: "2026-10-19", to: "2026-10-01" },
  ])
    assert.equal(schemas.dataSchema.safeParse(input).success, false);
  assert.equal(schemas.domainListSchema.parse({}).limit, 100);
});
test("empty and failed samples have null rates and separate failure counts", () => {
  assert.equal(score([], filters).engines[0].sov, null);
  const data = score(
    [
      snapshot,
      { ...snapshot, status: "failed" },
      { ...snapshot, status: "no_result" },
      { ...snapshot, status: "pending" },
      {
        ...snapshot,
        mentions: mentions.map((m) => ({ ...m, resolvable: false })),
      },
    ],
    filters,
  );
  const chat = data.engines[0];
  assert.equal(chat.validSamples, 1);
  assert.equal(chat.sov, 1);
  assert.equal(chat.citationRate, 1);
  assert.equal(chat.failedCount, 2);
  assert.equal(chat.unresolvableCount, 2);
  assert.equal(data.totalValidSamples, 1);
});
test("brand aliases count once per snapshot and mentions do not imply citations", () => {
  const row = {
    ...snapshot,
    mentions: [
      ...mentions.map((m) => ({ ...m, cited: false })),
      { ...mentions[0], label: "베스트라" },
    ],
  };
  const data = score([row], filters);
  assert.equal(data.engines[0].mentionedCount, 1);
  assert.equal(data.engines[0].citationRate, 0);
});
test("competitor denominator excludes unresolved labels", () => {
  const competitor = {
    subject: "competitor",
    label: "rival",
    mentioned: true,
    cited: false,
    resolvable: true,
  };
  const data = score(
    [
      { ...snapshot, mentions: [...mentions, competitor] },
      {
        ...snapshot,
        mentions: [
          ...mentions,
          { ...competitor, resolvable: false, mentioned: false },
        ],
      },
    ],
    filters,
  );
  assert.equal(data.competitors[0].mentionRate, 1);
});
test("responses parser reads message sections and excludes reasoning", () => {
  const result = normalizeVendor(
    "chatgpt",
    "llm_responses",
    envelope({
      items: [
        { type: "reasoning", sections: [{ text: "SECRET REASONING" }] },
        {
          type: "message",
          sections: [
            {
              type: "text",
              text: "Vestra is present",
              annotations: [{ url: "https://vestra.example", title: "Source" }],
            },
          ],
        },
      ],
    }),
  );
  assert.equal(result.answerText, "Vestra is present");
  assert.equal(result.citations.length, 1);
  assert.equal(result.citations[0].position, 1);
  assert.equal(JSON.stringify(result.raw).includes("SECRET"), false);
});
test("Gemini supports groundingChunks and URL citation variants", () => {
  const result = normalizeVendor(
    "gemini",
    "llm_scraper",
    envelope({
      groundingChunks: [{ web: { uri: "https://a.example", title: "A" } }],
      items: [
        { type: "gemini_text", markdown: "A response" },
        { type: "url_citation", url: "https://b.example" },
      ],
    }),
  );
  assert.equal(result.status, "ok");
  assert.equal(result.citations.length, 2);
});
test("AIO excludes organic text and preserves no_result", () => {
  const result = normalizeVendor(
    "ai_overviews",
    "serp_aio",
    envelope({ items: [{ type: "organic", text: "Not an AI answer" }] }),
  );
  assert.equal(result.status, "no_result");
  assert.equal(result.answerText, "");
  assert.throws(() =>
    normalizeVendor("chatgpt", "llm_scraper", envelope({ items: "invalid" })),
  );
});
test("KST weekly and daily buckets honor local Monday midnight", () => {
  assert.equal(
    periodBucket("daily", new Date("2026-10-18T15:00:00Z")),
    "2026-10-19",
  );
  assert.equal(
    periodBucket("weekly", new Date("2026-10-18T14:59:59Z")),
    "2026-10-12",
  );
  assert.equal(
    runKey(uid, "chatgpt", "weekly", new Date("2026-10-18T15:00:00Z")),
    `${uid}:chatgpt:weekly:2026-10-19`,
  );
});
test("cron secret must be configured and matched", () => {
  const before = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  assert.equal(verifyCronSecret(new Request("https://app.example")), false);
  process.env.CRON_SECRET = "test-secret";
  assert.equal(
    verifyCronSecret(
      new Request("https://app.example", {
        headers: { authorization: "Bearer wrong" },
      }),
    ),
    false,
  );
  assert.equal(
    verifyCronSecret(
      new Request("https://app.example", {
        headers: { authorization: "Bearer test-secret" },
      }),
    ),
    true,
  );
  if (before === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = before;
});
test("paid POST is never replayed on uncertain network outcome", async () => {
  process.env.DATAFORSEO_LOGIN = "test";
  process.env.DATAFORSEO_PASSWORD = "test";
  let calls = 0;
  const client = new DataForSeoClient(async () => {
    calls++;
    throw new Error("timeout");
  });
  await assert.rejects(
    client.task("ai_optimization/chat_gpt/llm_scraper/task_post", [{}], {
      ownerId: uid,
      requestId: "r",
    }),
    /submission_uncertain/,
  );
  assert.equal(calls, 1);
});
test("task identity and billing checkpoint are persisted before result polling", async () => {
  process.env.DATAFORSEO_LOGIN = "test";
  process.env.DATAFORSEO_PASSWORD = "test";
  const events = [];
  const client = new DataForSeoClient(async (url, options) => {
    events.push(options.method);
    return Response.json(
      options.method === "POST"
        ? envelope(null, 20100, 0.01)
        : envelope({ items: [] }),
    );
  });
  await client.task("ai_optimization/chat_gpt/llm_scraper/task_post", [{}], {
    ownerId: uid,
    requestId: "r",
    onTask: async (id, cost) => {
      assert.equal(id, "vendor-task");
      assert.equal(cost, 14);
      events.push("persist");
    },
  });
  assert.deepEqual(events, ["POST", "persist", "GET"]);
});
test("resuming a known task never sends another paid POST", async () => {
  const methods = [];
  const client = new DataForSeoClient(async (_url, options) => {
    methods.push(options.method);
    return Response.json(envelope({ items: [] }));
  });
  await client.task("ai_optimization/chat_gpt/llm_scraper/task_post", [{}], {
    ownerId: uid,
    requestId: "r",
    taskId: "existing-task",
  });
  assert.deepEqual(methods, ["GET"]);
});
test("vendor task error is checked even when HTTP succeeds", async () => {
  const client = new DataForSeoClient(async () =>
    Response.json(envelope(null, 40501, 0.005)),
  );
  let billed = 0;
  await assert.rejects(
    client.task("ai_optimization/chat_gpt/llm_scraper/task_post", [{}], {
      ownerId: uid,
      requestId: "r",
      onTask: async (_id, cost) => {
        billed = cost;
      },
    }),
    /vendor_status_40501/,
  );
  assert.equal(billed, 7);
});

test("vendor diagnostic payloads redact credentials without exposing request echoes", () => {
  const {
    sanitizeVendorResponse,
  } = require("../../external/vendor-response.ts");
  const before = process.env.DATAFORSEO_PASSWORD;
  process.env.DATAFORSEO_PASSWORD = "private-value";
  const clean = sanitizeVendorResponse({
    password: "private-value",
    headers: { authorization: "Basic private-value" },
    text: "answer private-value",
    items: [
      { type: "reasoning", text: "hidden" },
      { type: "message", text: "visible" },
    ],
  });
  assert.equal(clean.text, "answer [REDACTED]");
  assert.equal("password" in clean, false);
  assert.equal("headers" in clean, false);
  assert.equal(JSON.stringify(clean).includes("hidden"), false);
  assert.equal(JSON.stringify(clean).includes("visible"), true);
  if (before === undefined) delete process.env.DATAFORSEO_PASSWORD;
  else process.env.DATAFORSEO_PASSWORD = before;
});

test("domainless samples keep mention metrics while citation metrics stay null", () => {
  const row = { ...snapshot, domain: null, mentions: [mentions[0], { ...mentions[1], label: '', cited: false, resolvable: false }] };
  const data = score([row, { ...row, status: 'failed' }], filters);
  assert.equal(data.engines[0].validSamples, 1);
  assert.equal(data.engines[0].sov, 1);
  assert.equal(data.engines[0].citationValidSamples, 0);
  assert.equal(data.engines[0].citationRate, null);
  assert.equal(data.engines[0].unresolvableCount, 0);
  assert.equal(data.trend[0].sov, 1);
  assert.equal(data.trend[0].citationRate, null);
});
test("citation evidence remains valid when the brand judge is unresolved", () => {
  const row = { ...snapshot, mentions: [{ ...mentions[0], resolvable: false }, mentions[1]] };
  const data = score([row], filters);
  assert.equal(data.engines[0].sov, null);
  assert.equal(data.engines[0].citationRate, 1);
  assert.equal(data.engines[0].citationValidSamples, 1);
  assert.equal(data.trend[0].citationRate, 1);
});
test("mixed domain configurations use separate denominators", () => {
  const row = { ...snapshot, domain: null, mentions: [{ ...mentions[0], mentioned: false }] };
  const data = score([snapshot, row], filters);
  assert.equal(data.engines[0].sov, 0.5);
  assert.equal(data.engines[0].citationRate, 1);
  assert.equal(data.trend[0].validSamples, 2);
  assert.equal(data.trend[0].citationValidSamples, 1);
});
test("engine request contracts do not mix scraper and response options", () => {
  const { engineRequest } = require('../engines/request.ts');
  for (const engine of ['chatgpt', 'gemini', 'ai_overviews']) {
    assert.deepEqual(engineRequest(engine, '질문', 'ko-KR'), { keyword: '질문', location_code: 2410, language_code: 'ko' });
  }
  assert.deepEqual(engineRequest('perplexity', 'question', 'en-GB'), {
    user_prompt: 'question', model_name: 'sonar', web_search: true, web_search_country_iso_code: 'GB'
  });
});
test("live scraper fixtures verify accepted request contracts and successful parsing", () => {
  const { engineRequest } = require('../engines/request.ts');
  for (const engine of ['chatgpt', 'gemini']) {
    const fixture = require(`./fixtures/${engine}-scraper-live.json`);
    assert.deepEqual(engineRequest(engine, 'What is OpenAI?', 'en-US'), fixture.request[0]);
    assert.equal(fixture.submission.status_code, 20000);
    assert.equal(fixture.submission.task_status_code, 20100);
    assert.equal(fixture.response.tasks[0].status_code, 20000);
    const result = normalizeVendor(engine, 'llm_scraper', fixture.response);
    assert.equal(result.status, 'ok');
    assert.equal(result.answerText.length > 0, true);
    assert.equal(result.citations.length > 0, true);
  }
});
