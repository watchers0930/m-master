/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require */
require("../../visibility/__tests__/register.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { VERSIONS, MAX_REPAIR_CALLS, MAX_OUTPUT_TOKENS, strategyTool, buildPrompt, repairPrompt } = require("../prompt.ts");
const { snapshot } = require("./fixtures.cjs");
// 생성 절차(프롬프트·도구 스키마·strict·교정 횟수·교정 문구)가 바뀌면 promptVersion 을 올려야 한다.
// 올리지 않으면 같은 입력 해시가 이전 절차의 실패 리포트를 재사용해 새 절차가 실행되지 않는다(2026-11-06 v2.16.1 실수).
// 절차를 바꿨다면: prompt.ts 의 promptVersion 을 올리고, 아래 표에 새 버전과 지문을 추가한다.
const FINGERPRINTS = { "consulting-v3.2": "092cfc8474102cf8", "consulting-v3.3": "28826153be53d685" };
test("procedure fingerprint is pinned to promptVersion", () => {
  const messages = buildPrompt(snapshot);
  const repair = repairPrompt(messages, { id: "call", function: { name: "submit_strategy", arguments: "{}" } }, "REASON");
  const fingerprint = createHash("sha256").update(JSON.stringify({ messages, repair: repair.slice(messages.length), strategyTool,
    MAX_REPAIR_CALLS, MAX_OUTPUT_TOKENS, model: VERSIONS.model, schemaVersion: VERSIONS.schemaVersion })).digest("hex").slice(0, 16);
  assert.ok(VERSIONS.promptVersion in FINGERPRINTS, `새 promptVersion ${VERSIONS.promptVersion} 의 지문을 표에 추가하세요: ${fingerprint}`);
  assert.equal(fingerprint, FINGERPRINTS[VERSIONS.promptVersion], `생성 절차가 바뀌었습니다 — promptVersion 을 올리세요 (현재 지문 ${fingerprint})`);
});
