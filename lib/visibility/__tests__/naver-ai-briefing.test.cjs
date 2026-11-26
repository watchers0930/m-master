/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process, URL, Response */
require("./register.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
// budget.ts → http.ts → auth.ts(next-auth) 체인을 끊는다(track.test.cjs와 같은 방식)
require.cache[require.resolve("../../auth.ts")] = {
  exports: { requireSession: async () => ({ user: { id: "o1" } }) },
};
const fixture = require("./fixtures/naver-ai-briefing-live.json");
const { SerpApiClient } = require("../../external/serpapi.ts");
const { VendorError } = require("../../external/vendor-error.ts");
const { createNaverAiBriefing } = require("../engines/naver-ai-briefing.ts");

const KEY = "k".repeat(64);
process.env.SERPAPI_API_KEY = KEY;
const ctx = { ownerId: "o1", requestId: "r1" };

/** 엔진별 응답을 돌려주는 가짜 전송. 호출된 엔진 순서를 기록한다. */
function transport(byEngine, calls = []) {
  return Object.assign(
    async (url) => {
      const u = new URL(url);
      const engine = u.searchParams.get("engine");
      calls.push(engine);
      const r = byEngine[engine];
      if (r instanceof Error) throw r;
      const { status = 200, body } = r;
      return new Response(JSON.stringify(body), { status });
    },
    { calls },
  );
}
const engineWith = (t) => createNaverAiBriefing(() => new SerpApiClient(t));

test("통합검색에 브리핑이 바로 있으면 1회 호출로 본문·인용을 쓴다(실응답)", async () => {
  const t = transport({ naver: { body: fixture.inline.naver } });
  const r = await engineWith(t).capture(fixture.inline.query, "ko-KR", ctx);
  assert.deepEqual(t.calls, ["naver"]);
  assert.equal(r.status, "ok");
  assert.equal(r.source, "serpapi_naver");
  assert.ok(r.answerText.length > 100);
  assert.ok(r.citations.length >= 3);
  assert.deepEqual(r.citations.map((c) => c.position), r.citations.map((_, i) => i + 1));
  assert.equal(r.costKrw, 0);
  // 통합검색 웹 결과는 저장하지 않는다
  assert.equal(JSON.stringify(r.raw).includes("web_results"), false);
});

test("브리핑 본문이 지연 로딩이면 브리핑 전용 조회로 1회 더 가져온다(실응답)", async () => {
  const t = transport({ naver: { body: fixture.deferred.naver }, naver_ai_overview: { body: fixture.deferred.overview } });
  const r = await engineWith(t).capture(fixture.deferred.query, "ko-KR", ctx);
  assert.deepEqual(t.calls, ["naver", "naver_ai_overview"]);
  assert.equal(r.status, "ok");
  assert.equal(r.source, "serpapi_naver_ai_overview");
  assert.ok(r.citations.length >= 3);
});

test("통합검색에 브리핑이 없으면 브리핑 전용 조회를 하지 않고 no_result(노출 부풀림 방지, 실응답)", async () => {
  // overview는 이 질의에도 브리핑을 생성해 돌려준다(실측) — 호출되면 안 된다
  const t = transport({ naver: { body: fixture.absent.naver }, naver_ai_overview: { body: fixture.absent.overview } });
  const r = await engineWith(t).capture(fixture.absent.query, "ko-KR", ctx);
  assert.deepEqual(t.calls, ["naver"]);
  assert.equal(r.status, "no_result");
  assert.equal(r.answerText, "");
  assert.deepEqual(r.citations, []);
});

test("한국 외 시장은 호출 없이 거부", async () => {
  const t = transport({});
  const engine = engineWith(t);
  assert.equal(engine.supportsMarket("en-US"), false);
  assert.equal(engine.supportsMarket("ko-KR"), true);
  await assert.rejects(engine.capture("q", "en-US", ctx), (e) => e instanceof VendorError && e.reason === "unsupported_market");
  assert.deepEqual(t.calls, []);
});

test("실패 사유는 공용 어휘로, 오류에 키·요청 URL이 실리지 않는다", async () => {
  const cases = [
    [{ status: 429, body: { error: "Your account has run out of searches." } }, "vendor_payment_required"],
    [{ status: 200, body: { error: "Your account has run out of searches." } }, "vendor_payment_required"],
    [{ status: 401, body: { error: "Invalid API key." } }, "vendor_auth_failed"],
    [{ status: 429, body: { error: "Too many requests" } }, "vendor_rate_limited"],
    [{ status: 400, body: { error: "Missing query" } }, "vendor_request_rejected"],
    [{ status: 503, body: {} }, "vendor_http_failed"],
    [{ status: 200, body: { search_metadata: { status: "Error" } } }, "vendor_invalid_response"],
    [new TypeError("fetch failed " + KEY), "vendor_unavailable"],
  ];
  for (const [response, reason] of cases) {
    const t = transport({ naver: response });
    await assert.rejects(engineWith(t).capture("q", "ko-KR", ctx), (e) => {
      assert.ok(e instanceof VendorError, reason);
      assert.equal(e.reason, reason);
      assert.equal(e.costKrw, 0);
      assert.equal(String(e.message).includes(KEY), false);
      assert.equal(String(e.message).includes("serpapi.com"), false);
      return true;
    });
  }
});

test("결과 없음 메시지는 오류가 아니라 no_result", async () => {
  const t = transport({ naver: { body: { error: "Naver hasn't returned any results for this query." } } });
  const r = await engineWith(t).capture("q", "ko-KR", ctx);
  assert.equal(r.status, "no_result");
});

test("키가 없으면 호출하지 않고 vendor_not_configured", async () => {
  const saved = process.env.SERPAPI_API_KEY;
  process.env.SERPAPI_API_KEY = "  ";
  try {
    const t = transport({});
    await assert.rejects(engineWith(t).capture("q", "ko-KR", ctx), (e) => e.reason === "vendor_not_configured");
    assert.deepEqual(t.calls, []);
  } finally {
    process.env.SERPAPI_API_KEY = saved;
  }
});

test("깨진 인용·중복 URL·잘못된 주소는 걸러지고 순위는 1부터 다시 매긴다", async () => {
  const body = {
    search_metadata: { status: "Success" },
    ai_briefing: {
      markdown: "답변",
      references: [
        { index: 3, title: "A", link: "https://a.example.com/x" },
        { index: 4, title: "A2", link: "https://a.example.com/x" },
        { index: 5, link: "javascript:alert(1)" },
        { index: 6, link: null },
        { index: 7, title: "B", link: "https://blog.naver.com/b/1" },
      ],
    },
  };
  const r = await engineWith(transport({ naver: { body } })).capture("q", "ko-KR", ctx);
  assert.deepEqual(r.citations.map((c) => [c.url, c.position]), [["https://a.example.com/x", 1], ["https://blog.naver.com/b/1", 2]]);
});

test("브리핑 형태가 어긋나면 vendor_invalid_response", async () => {
  const body = { search_metadata: { status: "Success" }, ai_briefing: { markdown: 1, references: "x" } };
  await assert.rejects(
    engineWith(transport({ naver: { body } })).capture("q", "ko-KR", ctx),
    (e) => e.reason === "vendor_invalid_response",
  );
});

test("남은 횟수 조회는 account.json만 부른다(검색 차감 없음)", async () => {
  const paths = [];
  const client = new SerpApiClient(async (url) => {
    paths.push(new URL(url).pathname);
    return new Response(JSON.stringify({ plan_name: "Free Plan", plan_searches_left: 238, this_month_usage: 12 }));
  });
  const a = await client.account();
  assert.equal(a.plan_searches_left, 238);
  assert.deepEqual(paths, ["/account.json"]);
});

test("응답 본문·인용·보관본에 키가 섞여 와도 가려진다(앞뒤 공백 있는 env 포함)", async () => {
  const saved = process.env.SERPAPI_API_KEY;
  process.env.SERPAPI_API_KEY = ` ${KEY} `;
  try {
    const body = {
      search_metadata: { status: "Success" },
      ai_briefing: {
        markdown: `답변 ${KEY}`,
        references: [{ index: 1, title: `t ${KEY}`, link: `https://a.example.com/x?api_key=${KEY}` }],
        text_blocks: [{ type: "paragraph", snippet: KEY, serpapi_link: `https://serpapi.com/x?api_key=${KEY}` }],
      },
    };
    const r = await engineWith(transport({ naver: { body } })).capture("q", "ko-KR", ctx);
    const all = JSON.stringify([r.answerText, r.citations, r.raw]);
    assert.equal(all.includes(KEY), false);
    assert.ok(r.answerText.includes("[REDACTED]"));
    assert.equal(r.citations.length, 1);
  } finally {
    process.env.SERPAPI_API_KEY = saved;
  }
});

test("일시 장애(5xx·처리량 429·네트워크)는 다시 시도하고, 한도 소진은 다시 시도하지 않는다", async () => {
  const ok = { body: fixture.inline.naver };
  for (const first of [{ status: 503, body: {} }, { status: 429, body: { error: "Too many requests" } }, new TypeError("fetch failed")]) {
    let n = 0;
    const calls = [];
    const t = async (url) => {
      calls.push(new URL(url).searchParams.get("engine"));
      if (n++ === 0) {
        if (first instanceof Error) throw first;
        return new Response(JSON.stringify(first.body), { status: first.status });
      }
      return new Response(JSON.stringify(ok.body));
    };
    const r = await engineWith(t).capture(fixture.inline.query, "ko-KR", ctx);
    assert.equal(r.status, "ok");
    assert.deepEqual(calls, ["naver", "naver"]);
  }
  const calls = [];
  const quota = async (url) => {
    calls.push(new URL(url).searchParams.get("engine"));
    return new Response(JSON.stringify({ error: "Your account has run out of searches." }), { status: 429 });
  };
  await assert.rejects(engineWith(quota).capture("q", "ko-KR", ctx), (e) => e.reason === "vendor_payment_required");
  assert.deepEqual(calls, ["naver"]);
});

test("무료 네이버 엔진은 판정 비용만 예약해 유료 엔진 예산을 막지 않는다", async () => {
  const { captureReserveKrw, pendingReservedKrw, CAPTURE_RESERVE_KRW, FREE_CAPTURE_RESERVE_KRW } = require("../budget.ts");
  assert.equal(captureReserveKrw("chatgpt"), CAPTURE_RESERVE_KRW);
  assert.equal(captureReserveKrw("naver_ai_briefing"), FREE_CAPTURE_RESERVE_KRW);
  assert.ok(FREE_CAPTURE_RESERVE_KRW < CAPTURE_RESERVE_KRW);
  // 대기 중 스냅샷: 유료 2건 + 네이버 1건
  const pending = [{ engine: "chatgpt" }, { engine: "gemini" }, { engine: "naver_ai_briefing" }];
  const tx = {
    visibilitySnapshot: {
      count: async ({ where }) => pending.filter((p) => !where.engine || where.engine.in.includes(p.engine)).length,
    },
    seoTask: { aggregate: async () => ({ _sum: { reservedKrw: 0 } }) },
    consultingReport: { aggregate: async () => ({ _sum: { reservedKrw: 0 } }) },
  };
  assert.equal(await pendingReservedKrw(tx, "o1"), 2 * CAPTURE_RESERVE_KRW + FREE_CAPTURE_RESERVE_KRW);
});

test("브랜드 든 질문(branded_query)은 판정불가로 세지 않고, 시장 지원 엔진만 행으로 만든다", () => {
  const { score } = require("../score.ts");
  const snap = (failReason) => ({
    engine: "naver_ai_briefing", status: "ok", capturedAt: new Date(), failReason, citations: [], domain: "vestra.example",
    mentions: [{ subject: "brand", label: "Vestra", mentioned: false, cited: false, resolvable: false },
      { subject: "domain", label: "vestra.example", mentioned: false, cited: false, resolvable: true }],
  });
  const filters = { market: "ko-KR", from: "", to: "", queryId: null, domainId: null };
  const ko = score([snap("branded_query"), snap("judgment_unavailable")], filters);
  const naver = ko.engines.find((e) => e.engine === "naver_ai_briefing");
  assert.equal(naver.unresolvableCount, 1); // 실제 판정 실패 1건만
  assert.equal(naver.citationValidSamples, 2); // 인용은 둘 다 집계
  const us = score([], { ...filters, market: "en-US" });
  assert.equal(us.engines.some((e) => e.engine === "naver_ai_briefing"), false);
});

test("화면·서버 공용 브랜드 질문 판정(aliasInQuestion)", () => {
  const { aliasInQuestion, normalizeText } = require("../text.ts");
  const t = (q, a) => aliasInQuestion(normalizeText(q), normalizeText(a));
  assert.equal(t("PHP 개발 도구 추천", "HP"), false);
  assert.equal(t("베스트라의 등기부 분석", "베스트라"), true);
  assert.equal(t("VESTRA   등기부", "vestra"), true);
  assert.equal(t("a.b 추천", "a.b"), true);
  assert.equal(t("axb 추천", "a.b"), false);
  assert.equal(t("", "x"), false);
});
