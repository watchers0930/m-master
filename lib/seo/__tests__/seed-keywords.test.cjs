// 주제(씨앗) 키워드: 있으면 keywords_for_keywords, 없으면 keywords_for_site(2026-11-26 베스트라 첫 화면 기준 결과가 AI 키워드로 채워진 결함).
"use strict";
require("../../visibility/__tests__/register.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { keywordsRequest, parseKeywords } = require("../adapters/keywords.ts");
const { parseSeedKeywords, seedListIssue, canonicalSeeds, SEED_LIMIT } = require("../seed-keywords.ts");
const schemas = require("../../../schemas/seo.ts");

const input = { host: "vestra.ai.kr", market: "ko-KR" };
const base = { domainId: "clx0000000000000000000000", runKey: "11111111-1111-4111-8111-111111111111" };
const row = (keyword, search_volume) => ({ keyword, search_volume, competition: "LOW", competition_index: 12 });
const envelope = (result) => ({ status_code: 20000, tasks: [{ status_code: 20000, result }] });

test("씨앗이 있으면 관련 검색어(keywords_for_keywords), 없으면 사이트 기준(keywords_for_site)", () => {
  const seeded = keywordsRequest("keywords_for_site", { ...input, keywords: ["근저당확인", "전세사기확인"] });
  assert.equal(seeded.path, "keywords_data/google_ads/keywords_for_keywords/live");
  assert.deepEqual(seeded.body, [{ keywords: ["근저당확인", "전세사기확인"], location_code: 2410, language_code: "ko", sort_by: "search_volume" }]);
  assert.equal(seeded.units, 1);
  for (const keywords of [undefined, []]) {
    const site = keywordsRequest("keywords_for_site", { ...input, keywords });
    assert.equal(site.path, "keywords_data/google_ads/keywords_for_site/live");
    assert.deepEqual(site.body, [{ target: "vestra.ai.kr", location_code: 2410, language_code: "ko" }]);
  }
  const many = Array.from({ length: 30 }, (_, i) => `k${i}`);
  assert.equal(keywordsRequest("keywords_for_site", { ...input, keywords: many }).body[0].keywords.length, SEED_LIMIT);
  // Labs 순위는 씨앗과 무관하게 도메인 기준
  assert.equal(keywordsRequest("labs_ranked", { ...input, keywords: ["x"] }).path, "dataforseo_labs/google/ranked_keywords/live");
});

test("씨앗 결과는 씨앗으로 거르지 않고 관련 검색어 전체를 그대로 저장한다(띄어쓰기 변형도 데이터는 보존)", () => {
  // 실측 응답(2026-11-26, $0.09) 앞부분과 같은 모양
  const response = envelope([row("근저당확인", 320), row("근저당 확인", 320), row("전세계약주의사항", 170), row("선순위 보증금 확인 방법", 90)]);
  const parsed = parseKeywords(response, "keywords_for_site", { ...input, keywords: ["근저당확인"] });
  assert.deepEqual(parsed.metrics.map((m) => m.keyword), ["근저당확인", "근저당 확인", "전세계약주의사항", "선순위 보증금 확인 방법"]);
  assert.equal(parsed.observations.length, 0);
});

test("네이버 볼륨은 여전히 요청한 키워드만 남긴다", () => {
  const parsed = parseKeywords(envelope([row("seo", 10), row("other", 20)]), "naver_volume", { ...input, keywords: ["SEO"] });
  assert.deepEqual(parsed.metrics.map((m) => m.keyword), ["seo"]);
});

test("서버 검증: 진단·리서치 모두 씨앗 20개·80자 한도, 공급자 금지 문자 거절, 중복 제거", () => {
  const ok = schemas.auditSchema.parse({ ...base, keywords: [" 근저당확인 ", "근저당확인", "전세사기"] });
  assert.deepEqual(ok.keywords, ["근저당확인", "전세사기"]);
  assert.equal(schemas.auditSchema.parse(base).keywords, undefined);
  for (const schema of [schemas.auditSchema, schemas.researchSchema]) {
    assert.throws(() => schema.parse({ ...base, keywords: Array.from({ length: 21 }, (_, i) => `k${i}`) }));
    assert.throws(() => schema.parse({ ...base, keywords: ["가".repeat(81)] }));
    assert.throws(() => schema.parse({ ...base, keywords: ["   "] }));
    for (const bad of ["SEO 🚀", "전세(사기)", "전세?", "a@b", "x\u0000y", "「전세」", "a,b", "×"])
      assert.throws(() => schema.parse({ ...base, keywords: ["전세사기", bad] }), bad);
    // 공식 정규식 대조(codex 2차): U+0250·사용자 영역 U+E000은 금지, €·々는 허용
    for (const bad of ["\u0250", "a\uE000"]) assert.throws(() => schema.parse({ ...base, keywords: [bad] }), bad);
    for (const good of ["근저당 확인", "c++", "2026 전세", "e-mail", "a.b", "전세사기 확인 방법", "전세·사기", "10€", "々"])
      assert.doesNotThrow(() => schema.parse({ ...base, keywords: [good] }), good);
    // 20개 한도는 중복 제거 뒤 기준(같은 키워드 반복은 하나)
    assert.doesNotThrow(() => schema.parse({ ...base, keywords: [...Array.from({ length: 20 }, (_, i) => `k${i}`), "K0"] }));
  }
});

test("화면 입력: 자르지 않고, 서버와 같은 기준으로 미리 알린다", () => {
  assert.deepEqual(parseSeedKeywords(" 근저당확인, ,전세사기\n등기부등본 "), ["근저당확인", "전세사기", "등기부등본"]);
  const many = parseSeedKeywords(Array.from({ length: 25 }, (_, i) => `k${i}`).join(","));
  assert.equal(many.length, 25);
  assert.match(seedListIssue(many), /20개/);
  assert.equal(seedListIssue([...Array.from({ length: 20 }, (_, i) => `k${i}`), "K0"]), null);
  assert.match(seedListIssue(["전세(사기)"]), /기호/);
  assert.equal(seedListIssue(["근저당 확인"]), null);
  assert.deepEqual(parseSeedKeywords(""), []);
  // 재시도 서명은 서버 정규화와 같아야 한다: 순서·반복만 다른 입력은 같은 요청
  assert.deepEqual(canonicalSeeds(["b", "seo", "seo"]), canonicalSeeds(["seo", "b"]));
  const server = (keywords) => [...schemas.researchSchema.parse({ ...base, keywords }).keywords].sort();
  for (const list of [["seo", "SEO", "b"], ["b", "seo"], ["전세", "근저당", "전세"]])
    assert.deepEqual(canonicalSeeds(list), server(list));
});

test("금지 문자표는 한글 음절·자모·숫자·영문을 하나도 막지 않는다(공식 정규식 변환 결과 고정)", () => {
  const blocked = [];
  for (const [from, to] of [[0xac00, 0xd7a3], [0x1100, 0x11ff], [0x3131, 0x318e], [0x30, 0x39], [0x41, 0x5a], [0x61, 0x7a]])
    for (let c = from; c <= to; c++) if (seedListIssue([String.fromCharCode(c)])) blocked.push(c.toString(16));
  assert.deepEqual(blocked, []);
});
