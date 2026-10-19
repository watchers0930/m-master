/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require */
require("./register.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
let calls = 0,
  failure = false,
  costs = [];
class JudgeClient {
  chat = {
    completions: {
      create: async (options) => {
        calls++;
        if (failure) throw new Error("upstream failed");
        const { labels } = JSON.parse(options.messages[1].content);
        return {
          usage: { prompt_tokens: 100, completion_tokens: 50 },
          choices: [
            {
              message: {
                content: JSON.stringify({
                  judgments: labels.map((label) => ({
                    label,
                    mentioned: true,
                    sentiment: "positive",
                  })),
                }),
              },
            },
          ],
        };
      },
    },
  };
}
require.cache[require.resolve("openai")] = { exports: JudgeClient };
require.cache[require.resolve("../../cost/tracker.ts")] = {
  exports: { trackCost: async (options) => costs.push(options) },
};
const { detect, calcJudgeKrw } = require("../detect.ts");
const input = {
  ownerId: "owner",
  answerText: "Vestra offers a service.",
  citations: [],
  domain: "vestra.example",
  brandAliases: ["Vestra"],
  competitorAliases: [],
};
test("clear brand matches normalize case and Unicode without an LLM call", async () => {
  calls = 0;
  const result = await detect({
    ...input,
    answerText: "ＶＥＳＴＲＡ offers a service.",
  });
  assert.equal(result.mentions[0].mentioned, true);
  assert.equal(result.mentions[0].cited, false);
  assert.equal(calls, 0);
});
test("citation-only evidence does not fabricate a textual mention", async () => {
  const result = await detect({
    ...input,
    answerText: "A useful service.",
    citations: [{ url: "https://vestra.example/path", position: 2 }],
  });
  assert.equal(result.mentions[0].mentioned, false);
  assert.equal(result.mentions[0].cited, true);
  assert.equal(result.mentions[0].position, 2);
});
test("spoofed suffix and www hosts never match the registered domain", async () => {
  const result = await detect({
    ...input,
    citations: [
      { url: "https://vestra.example.evil.example", position: 1 },
      { url: "https://www.vestra.example", position: 2 },
    ],
  });
  assert.equal(result.mentions[0].cited, false);
});
test("ambiguous aliases are judged in one bounded batch and billed at mini pricing", async () => {
  calls = 0;
  costs = [];
  const result = await detect({
    ...input,
    answerText: "Apple and Meta have services.",
    brandAliases: ["Apple"],
    competitorAliases: ["Meta"],
  });
  assert.equal(calls, 1);
  assert.equal(result.mentions[0].sentiment, "positive");
  assert.equal(costs[0].kind, "chat");
  assert.equal(costs[0].krw, calcJudgeKrw(100, 50));
  assert.equal(costs[0].tokensIn, 100);
});
test("failed judgments and missing domains remain unresolved rather than negative samples", async () => {
  failure = true;
  const result = await detect({
    ...input,
    answerText: "Apple is a word.",
    brandAliases: ["Apple"],
    domain: null,
  });
  assert.equal(result.mentions[0].resolvable, false);
  assert.equal(result.failReason, "judgment_unavailable");
  assert.equal(
    result.mentions.find((m) => m.subject === "domain").resolvable,
    false,
  );
  failure = false;
});

test("missing domain is citation metadata and does not mark a valid brand judgment failed", async () => {
  const result = await detect({ ...input, domain: null });
  assert.equal(result.failReason, undefined);
  assert.equal(result.mentions[0].resolvable, true);
  assert.equal(result.mentions[0].mentioned, true);
  assert.equal(result.mentions.find(m => m.subject === 'domain').resolvable, false);
});
