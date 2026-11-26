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
test("질문에 든 브랜드는 답변에 나와도 판정 불가(언급률 집계 제외)·판정 모델 호출 없음, 인용은 집계", async () => {
  for (const [query, answerText] of [
    ["Vestra 등기부 분석", "Vestra 등기부 분석은 권리 관계를 파악하는 과정입니다."],
    ["Vestra 등기부 분석", "Vestra 등기부 분석을 추천합니다. 이 회사의 정확도는 99%입니다."],
    ["vestra의 등기부 분석", "Vestra 등기부 분석은 과정입니다."],
  ]) {
    calls = 0;
    const result = await detect({
      ...input,
      query,
      answerText,
      citations: [{ url: "https://vestra.example/a", position: 1 }],
    });
    const brand = result.mentions[0];
    assert.equal(calls, 0, query);
    assert.equal(brand.mentioned, false);
    assert.equal(brand.resolvable, false);
    const domain = result.mentions.find((m) => m.subject === "domain");
    assert.equal(domain.cited, true);
    assert.equal(domain.resolvable, true);
    assert.equal(result.failReason, "branded_query");
  }
});
test("질문에 든 경쟁사만 판정 불가, 질문에 없는 브랜드는 평소대로 언급", async () => {
  calls = 0;
  const result = await detect({
    ...input,
    query: "Rival 등기부 분석",
    competitorAliases: ["Rival"],
    answerText: "Rival 등기부 분석 대신 Vestra offers a service.",
  });
  const brand = result.mentions.find((m) => m.subject === "brand");
  const rival = result.mentions.find((m) => m.subject === "competitor");
  assert.equal(calls, 0);
  assert.equal(brand.mentioned, true);
  assert.equal(brand.resolvable, true);
  assert.equal(rival.mentioned, false);
  assert.equal(rival.resolvable, false);
});
test("질문이 없으면(기존 호출) 판정은 이전과 같다", async () => {
  calls = 0;
  const result = await detect({ ...input, answerText: "Vestra offers a service." });
  assert.equal(result.mentions[0].mentioned, true);
  assert.equal(result.mentions[0].resolvable, true);
});
test("질문 속 브랜드는 앞쪽 단어 경계로 찾는다: PHP 속 HP는 아님, 조사 붙은 베스트라의는 맞음", async () => {
  calls = 0;
  const php = await detect({ ...input, brandAliases: ["Vestra"], query: "AVestra 개발 도구 추천", answerText: "Vestra offers a service." });
  assert.equal(php.mentions[0].resolvable, true);
  assert.equal(php.mentions[0].mentioned, true);
  assert.equal(php.failReason, undefined);
  const josa = await detect({ ...input, brandAliases: ["베스트라"], query: "베스트라의 등기부 분석", answerText: "베스트라 등기부 분석은 과정입니다." });
  assert.equal(josa.mentions[0].resolvable, false);
  assert.equal(josa.failReason, "branded_query");
});
test("판정 실패가 있으면 branded_query보다 judgment_unavailable이 우선", async () => {
  failure = true;
  try {
    const result = await detect({
      ...input,
      query: "Vestra 등기부 분석",
      competitorAliases: ["HP"],
      answerText: "Vestra 등기부 분석. HP는 좋다.",
    });
    assert.equal(result.failReason, "judgment_unavailable");
  } finally {
    failure = false;
  }
});
