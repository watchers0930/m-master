/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process, Response, setTimeout */
require("../../visibility/__tests__/register.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");

// 감사 로그·DB는 메모리 가짜로(발송 1회 보장 검증용)
const audit = [];
let auditFails = false;
require.cache[require.resolve("../../auth.ts")] = { exports: { requireSession: async () => ({ user: { id: "x" } }) } };
require.cache[require.resolve("../../prisma.ts")] = {
  exports: {
    prisma: {
      auditLog: {
        findFirst: async ({ where }) => audit.find((a) => a.action === where.action && a.targetId === where.targetId) ?? null,
        create: async ({ data }) => { if (auditFails) throw new Error("db down"); audit.push(data); return data; },
      },
      $executeRaw: () => new Promise(() => {}), // 멈춘 DB
    },
  },
};

const { checkDataForSeo, checkSerpApi } = require("../report/checks/vendors.ts");
const { runChecks, formatReport } = require("../report/build.ts");
const { sendDailyReport, reportRecipients } = require("../report/send.ts");
const { VendorError } = require("../../external/vendor-error.ts");

const now = new Date("2026-11-26T23:00:00Z"); // 11-27(금) 08:00 KST

test("DataForSEO 잔액: 0 이하 이상·$5 미만 주의·조회 실패는 이상(사유 코드만)", async () => {
  assert.equal((await checkDataForSeo({ balanceUsd: async () => -0.06 })).level, "error");
  assert.match((await checkDataForSeo({ balanceUsd: async () => -0.06 })).summary, /-\$0\.06/);
  assert.equal((await checkDataForSeo({ balanceUsd: async () => 3 })).level, "warn");
  assert.equal((await checkDataForSeo({ balanceUsd: async () => 50 })).level, "ok");
  const failed = await checkDataForSeo({ balanceUsd: async () => { throw new VendorError("vendor_auth_failed"); } });
  assert.equal(failed.level, "error");
  assert.match(failed.summary, /vendor_auth_failed/);
});

test("SerpApi 한도: 0 이상·25 미만 주의", async () => {
  assert.equal((await checkSerpApi({ account: async () => ({ plan_searches_left: 0 }) })).level, "error");
  assert.equal((await checkSerpApi({ account: async () => ({ plan_searches_left: 10 }) })).level, "warn");
  assert.equal((await checkSerpApi({ account: async () => ({ plan_searches_left: 237, searches_per_month: 250 }) })).level, "ok");
});

test("점검 하나가 예외여도 나머지는 그대로, 실패 항목은 '점검 실패'로 실린다(원문 오류 미노출)", async () => {
  const results = await runChecks({ now }, [
    { key: "a", title: "A", run: async () => ({ key: "a", title: "A", level: "ok", summary: "정상", lines: [] }) },
    { key: "b", title: "B", run: async () => { throw new Error("secret-key-123 leaked"); } },
  ]);
  assert.equal(results[0].level, "ok");
  assert.equal(results[1].level, "error");
  assert.equal(results[1].summary.includes("secret-key-123"), false);
});

test("보고서 제목·순서·기준 시각(KST)", () => {
  const r = formatReport([
    { key: "x", title: "X", level: "ok", summary: "s", lines: [] },
    { key: "y", title: "Y", level: "error", summary: "s", lines: ["l"] },
    { key: "z", title: "Z", level: "warn", summary: "s", lines: [] },
  ], now);
  assert.equal(r.subject, "[MINTEQ 운영] 11/27(금) 이상 1 · 주의 1");
  assert.equal(r.kstDay, "2026-11-27");
  assert.ok(r.text.includes("08:00 KST 기준"));
  assert.ok(r.text.indexOf("🔴") < r.text.indexOf("🟡") && r.text.indexOf("🟡") < r.text.indexOf("🟢"));
  assert.equal(formatReport([{ key: "x", title: "X", level: "ok", summary: "s", lines: [] }], now).subject, "[MINTEQ 운영] 11/27(금) 정상");
});

test("하루 1통: 보내면 기록하고 같은 날 두 번째 실행은 안 보낸다. 발송 실패는 기록하지 않아 재시도된다", async () => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.ADS_ALERT_FROM = "noreply@example.com";
  process.env.OPS_REPORT_EMAILS = "boss@example.com";
  const fakeChecks = async () => [{ key: "x", title: "X", level: "ok", summary: "s", lines: [] }];
  const sent = [];
  const transport = async (_url, init) => { sent.push(init); return new Response(JSON.stringify({ id: "m1" }), { status: 200 }); };

  await assert.rejects(sendDailyReport({ now, transport: async () => new Response("{}", { status: 500 }), runChecks: fakeChecks }), /ops_report_/);
  assert.equal(audit.length, 0);

  const first = await sendDailyReport({ now, transport, runChecks: fakeChecks });
  assert.equal(first.status, "sent");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].headers["Idempotency-Key"], "ops-report-2026-11-27");
  assert.equal(audit.length, 1);

  const second = await sendDailyReport({ now: new Date(now.getTime() + 30 * 60000), transport, runChecks: fakeChecks });
  assert.equal(second.status, "already_sent");
  assert.equal(sent.length, 1);
});

test("409는 발송 증거가 아니다: 기록하지 않고 실패로 남긴다(앞 요청이 결국 실패해도 '보냄'으로 굳지 않게)", async () => {
  audit.length = 0;
  const day = new Date("2026-11-28T23:00:00Z");
  await assert.rejects(
    sendDailyReport({ now: day, transport: async () => new Response("{}", { status: 409 }), runChecks: async () => [] }),
    /ops_report_resend_http_409/,
  );
  assert.equal(audit.length, 0);
});

test("기록(감사로그) 실패는 삼키지 않고 드러난다", async () => {
  audit.length = 0;
  auditFails = true;
  try {
    await assert.rejects(
      sendDailyReport({ now: new Date("2026-11-29T23:00:00Z"), transport: async () => new Response("{}", { status: 200 }), runChecks: async () => [] }),
      /db down/,
    );
  } finally {
    auditFails = false;
  }
});

test("수신자는 OPS_REPORT_EMAILS만 — 광고 알림 수신자로 대신 보내지 않고, 설정이 없으면 조용히 넘기지 않고 실패", async () => {
  delete process.env.OPS_REPORT_EMAILS;
  process.env.ADS_ALERT_EMAILS = "ads-manager@example.com";
  assert.deepEqual(reportRecipients(), []);
  await assert.rejects(sendDailyReport({ now: new Date("2026-12-01T23:00:00Z"), runChecks: async () => [] }), /ops_report_not_configured/);
});

test("크론 결과의 내부 실패 수(HTTP 200이어도): failed·accounts[].outcome·processed[].error·status=failed", () => {
  const { countFailures, assessResult } = require("../../cron/heartbeat.ts");
  assert.equal(countFailures({ processed: 3, skipped: 0, failed: 2 }), 2); // GEO·초안
  assert.equal(countFailures({ accounts: [{ outcome: "ok" }, { outcome: "error" }] }), 1); // 광고
  assert.equal(countFailures({ scanned: 2, processed: [{ error: true }, { error: false }] }), 1); // SEO
  assert.equal(countFailures({ cafe: [{ status: "published" }], idea_jobs: [{ status: "failed" }], held: 1 }), 1); // 예약 발행
  assert.equal(countFailures({ failed: [{ id: 1 }, { id: 2 }] }), 2);
  // 광고: 호출 실패를 outcome 'ok' + skippedBatches로 돌려주는 경우, 감시의 끄기 실패·알림 발송 실패
  assert.equal(countFailures({ accounts: [{ outcome: "ok", updated: 0, skippedBatches: 4 }] }), 4);
  assert.equal(countFailures({ accounts: [{ outcome: "ok", paused: 1, pauseFailed: 1, drift: 3 }], alerts: { sent: 0, failed: 2 } }), 3);
  // 예약 발행 최종 실패
  assert.equal(countFailures({ social: [{ status: "failed_final" }], cafe: [{ status: "published" }] }), 1);
  // 정상 값은 세지 않는다
  assert.equal(countFailures({ skipped: "already_claimed", accounts: [], alerts: null }), 0);
  assert.equal(countFailures({ accounts: [{ outcome: "ok", paused: 2, drift: 1, skippedBatches: 0 }], alerts: { sent: 3, failed: 0 } }), 0);
  assert.equal(countFailures(null), 0);
  assert.deepEqual(assessResult({ generated: 0, failed: 10 }), { outcome: "failed", code: "items_failed:10" });
  assert.deepEqual(assessResult({ generated: 3, failed: 0 }), { outcome: "succeeded" });
});

test("크론 기준표가 vercel.json 일정과 1:1(새 크론을 추가하면 기준도 정해야 한다)", () => {
  const { CRON_EXPECTATIONS } = require("../../cron/schedule.ts");
  const vercel = require("../../../vercel.json");
  const paths = [...new Set(vercel.crons.map((c) => c.path.replace("/api/cron/", "")))].sort();
  assert.deepEqual(Object.keys(CRON_EXPECTATIONS).sort(), paths);
});

test("점검 하나가 끝나지 않아도 시간 초과로 끊고 보고서는 나간다", async () => {
  const build = require("../report/build.ts");
  const saved = build.CHECK_TIMEOUT_MS;
  const results = await Promise.race([
    build.runChecks({ now }, [{ key: "hang", title: "H", run: () => new Promise(() => {}) }]),
    new Promise((_, reject) => setTimeout(() => reject(new Error("runChecks did not time out")), saved + 5000)),
  ]);
  assert.equal(results[0].level, "error");
  assert.match(results[0].summary, /시간 초과/);
});

test("DB가 멈춰도 실행 기록은 상한 시간 안에 끝난다(크론 응답을 붙잡지 않음)", async () => {
  const { recordCronRun, HEARTBEAT_TIMEOUT_MS } = require("../../cron/heartbeat.ts");
  const started = Date.now();
  await recordCronRun("ads-guard", "succeeded");
  const took = Date.now() - started;
  assert.ok(took >= HEARTBEAT_TIMEOUT_MS - 50 && took < HEARTBEAT_TIMEOUT_MS + 1000, String(took));
});
