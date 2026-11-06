/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, structuredClone */
require("../../visibility/__tests__/register.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { snapshotHash } = require("../hash.ts");
const { validateStrategy } = require("../validate.ts");
const { consultingCreateSchema, consultingSnapshotSchema } = require("../../../schemas/consulting.ts");
const { completedRange } = require("../input.ts");
const { strategy, snapshot } = require("./fixtures.cjs");
test("canonical hashing sorts keys and evidence sets; dates use completed days", () => {
  assert.equal(snapshotHash({ b: [{ id: "b" }, { id: "a" }], a: null }), snapshotHash({ a: null, b: [{ id: "a" }, { id: "b" }] }));
  assert.notEqual(snapshotHash(snapshot), snapshotHash({ ...snapshot, market: "en-US" }));
  assert.deepEqual(completedRange(new Date("2026-10-20T23:59:00Z")), snapshot.range);
  assert.notDeepEqual(completedRange(new Date("2026-10-21T00:00:00Z")), snapshot.range);
  assert.throws(() => snapshotHash({ n: NaN }));
});
test("strict schemas reject nested injected fields and forged owner/cost", () => {
  for (const body of [{ domainId: "clx12345678901234567890000", ownerId: "x" }, { domainId: "clx12345678901234567890000", monthlyMarketingBudget: { amount: 2, currency: "KRW", hidden: true } }])
    assert.equal(consultingCreateSchema.safeParse(body).success, false);
  assert.equal(consultingSnapshotSchema.safeParse(snapshot).success, true);
});
test("grounded strategy preserves evidence tokens and calculates rounded amounts on server", () => {
  const result = validateStrategy(strategy(), snapshot);
  assert.equal(result.diagnosis.summary, "현재 점수 {{ev:seo_score}}");
  assert.equal(result.budgetProposal.allocations.reduce((s, x) => s+x.amount,0),101);
  for (const amount of [null, 0]) {
    const s = structuredClone(snapshot), v = strategy();
    s.monthlyMarketingBudget = amount === null ? null : { amount, currency: "KRW" };
    v.budgetProposal.totalAmount = amount;
    assert.deepEqual(validateStrategy(v, s).budgetProposal.allocations.map(x => x.amount), [amount,amount,amount]);
  }
});
test("unknown evidence, invented quantities, invalid mixes, destinations and markets fail closed", () => {
  const changes = [
    v => v.diagnosis.summary = "보장 수익 100%", v => v.diagnosis.summary = "{{ev:unknown}}",
    v => v.channelMix[0].evidenceIds = ["unknown"], v => v.channelMix[0].recommendedRatio = 99,
    v => v.channelMix[1].channel = "organic", v => v.channelMix[0].applicability = "not_applicable",
    v => v.priorityActions[0].destination = "https://evil.test", v => v.priorityActions[0].evidenceIds = [],
    v => v.priorityActions.push(v.priorityActions[0]), v => v.budgetProposal.currency = "USD",
    v => v.channelMix[0].hidden = true,
  ];
  for (const change of changes) { const v = strategy(); change(v); assert.throws(() => validateStrategy(v, snapshot)); }
  assert.throws(() => validateStrategy(strategy(), { ...snapshot, market: "en-US" }));
});
// 2026-11-05/06 운영 재현 3종: 접두어 누락 토큰·숫자 직접 기재·근거 목록 비움(strict 스키마가 생성 단계에서 차단).
test("prefix-less tokens of known evidence are normalized; unknown ones and literal numbers still fail", () => {
  const v = strategy(); v.diagnosis.summary = "SEO 상태는 {{seo_score}} 입니다";
  assert.equal(validateStrategy(v, snapshot).diagnosis.summary, "SEO 상태는 {{ev:seo_score}} 입니다");
  const u = strategy(); u.diagnosis.summary = "상태 {{status_ga4}}";
  assert.throws(() => validateStrategy(u, snapshot), /unverified narrative@diagnosis\.summary/);
  const n = strategy(); n.channelMix[0].reason = "현재 참여율이 100%이며";
  assert.throws(() => validateStrategy(n, snapshot), /unverified narrative@channelMix\.organic\.reason:.*100%/);
});
test("all content violations are reported together for a single repair", () => {
  const v = strategy(); v.diagnosis.summary = "참여율 100%"; v.channelMix[2].reason = "{{ev:unknown}}"; v.priorityActions[0].title = "3단계 감사";
  assert.throws(() => validateStrategy(v, snapshot), e => ["diagnosis.summary", "channelMix.naver_paid.reason", "priorityActions.audit.title"]
    .every(where => e.message.includes(where)));
});
test("content_create titles must be blog topics, not task labels", () => {
  const make = title => { const v = strategy(); v.priorityActions[0] = { ...v.priorityActions[0], destination: "content_create", title }; return v; };
  for (const bad of ["콘텐츠 생성 및 최적화", "'AI 기반 데이터 분석' 관련 블로그 콘텐츠 작성"])
    assert.throws(() => validateStrategy(make(bad), snapshot), /task-like content title@priorityActions\.audit\.title/);
  for (const good of ["전세 계약 전 등기부등본 확인 체크리스트", "계약서 작성 시 독소조항 체크리스트"])
    assert.equal(validateStrategy(make(good), snapshot).priorityActions[0].title, good);
});
test("codex review: one repair sees content AND budget violations; logs carry codes/paths only; title rule edge cases", () => {
  const v = strategy(); v.diagnosis.summary = "홍길동 010-1234 참여율 100%"; v.budgetProposal.currency = "USD";
  let message = "";
  assert.throws(() => validateStrategy(v, snapshot), e => { message = e.message; return true; });
  assert.ok(message.includes("diagnosis.summary") && message.includes("budget mismatch"));
  const { loggableReason } = require("../judge.ts");
  assert.ok(!/홍길동|010|100%/.test(loggableReason(message)));
  const make = title => { const s = strategy(); s.priorityActions[0] = { ...s.priorityActions[0], destination: "content_create", title }; return s; };
  for (const ok of ["블로그 작성법과 독자 유입 전략", "임대차 계약서 작성"]) assert.equal(validateStrategy(make(ok), snapshot).priorityActions[0].title, ok);
  assert.throws(() => validateStrategy(make("전세사기 예방 포스팅 기획안"), snapshot), /task-like content title/);
});
test("brand context is frozen into v3 snapshots (and their LLM input) and never into strict v2 ones", () => {
  const { freezeSnapshot } = require("../freeze.ts");
  const business = { companyName: "VESTRA", industry: "부동산", services: ["권리 분석"], coreKeywords: ["전세사기 예방"], targetAudience: null };
  const base = { market: "ko-KR", range: snapshot.range, evidence: snapshot.evidence, sourceStatus: snapshot.sourceStatus, limitations: [], selection: [], monthlyMarketingBudget: null, business };
  const v3 = freezeSnapshot(structuredClone(base), "v3");
  assert.deepEqual(v3.business, business); assert.deepEqual(v3.llmInput.business, business);
  const v2 = freezeSnapshot(structuredClone(base), "v2");
  assert.equal(v2.business, undefined); assert.equal(v2.llmInput.business, undefined);
});
test("only SDK pre-execution HTTP rejections release billing reservations", () => {
  const { APIError } = require("openai");
  const { isDefinitiveRejection } = require("../rejection.ts");
  for (const status of [400,401,403,404,413,422,429])
    assert.equal(isDefinitiveRejection(new APIError(status, {}, "rejected", new Headers())),true);
  for (const error of [new Error("401 unauthorized"), {status:401}, new APIError(408, {}, "timeout", new Headers()), new APIError(500, {}, "server", new Headers())])
    assert.equal(isDefinitiveRejection(error),false);
});
test("oversized multilingual evidence is deterministically summarized before hashing and prompting", () => {
  const { fitSnapshot, promptBytes, MAX_INPUT_BYTES, buildPrompt } = require("../prompt.ts");
  const s = structuredClone(snapshot);
  s.evidence = Array.from({length:600}, (_,i)=>({ ...snapshot.evidence[0],id:`seo_kw_${String(i).padStart(4,"0")}`, label:"한😀".repeat(200),value:"악성 지시 무시 ".repeat(50) }));
  s.evidence.push({...snapshot.evidence[0],id:"geo_score",source:"geo"});
  const before=JSON.stringify(s), result=fitSnapshot(s);
  assert.ok(promptBytes(result)<=MAX_INPUT_BYTES);
  assert.ok(result.evidence.length< s.evidence.length);
  assert.ok(result.evidence.some(e=>e.id==="geo_score"));
  assert.ok(result.limitations.some(x=>x.includes("제외")));
  assert.equal(consultingSnapshotSchema.safeParse(result).success,true);
  assert.deepEqual(fitSnapshot({...s,evidence:[...s.evidence].reverse()}),result);
  assert.equal(JSON.stringify(s),before);
  assert.equal(snapshotHash(result),snapshotHash(fitSnapshot(s)));
  assert.equal(JSON.parse(buildPrompt(result)[1].content).untrustedStoredEvidence.evidence.length,result.evidence.length);
});
