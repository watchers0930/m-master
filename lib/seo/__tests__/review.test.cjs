/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require */
require("../../visibility/__tests__/register.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { publicFailReason } = require("../messages.ts");
test("public failure reasons allow known Korean messages and hide internal/debug payloads", () => {
  for (const reason of [
    "submission_uncertain",
    "result_reconciliation_required",
    "DB password=secret",
    "__proto__",
    "constructor",
    "내부 SQL 오류: secret",
  ]) {
    const message = publicFailReason(reason, "uncertain");
    assert.match(message, /[가-힣]/);
    assert.equal(message.includes(reason), false);
    assert.equal(message.includes("secret"), false);
  }
  assert.equal(publicFailReason(null, "failed"), null);
  assert.equal(publicFailReason("submission_uncertain", "completed"), null);
  assert.equal(
    publicFailReason("외부 수집에 실패했습니다.", "failed"),
    "외부 수집에 실패했습니다.",
  );
  assert.equal(
    publicFailReason("debug", "submitted"),
    "결과 확인 대기 중입니다.",
  );
});
