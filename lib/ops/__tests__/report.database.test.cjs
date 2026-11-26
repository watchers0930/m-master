/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process, Request */
// 운영 아침 보고서 점검 SQL — 실DB(PGlite, 전체 schema.prisma). 가짜 DB로는 조건(부모 관계·질문별 주기·시각 비교)을 검증할 수 없어서(codex MED).
require("../../visibility/__tests__/register.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { setupAdsDb } = require("../../ads/__tests__/fixtures/ads-db.cjs");
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;

const NOW = new Date("2026-12-02T23:00:00Z"); // KST 12-03 08:00
const BLOB = "v1:0123456789abcdef:SEALEDCIPHERTEXT";
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600000);

test("운영 보고서 점검 SQL on a real database", { skip: !packageDir && "Set PGLITE_SOCKET_PACKAGE" }, async (t) => {
  const env = await setupAdsDb(packageDir);
  try {
    const { client } = env;
    const { checkAds } = require("../report/checks/ads.ts");
    const { checkGeo } = require("../report/checks/geo.ts");
    const { checkSeo } = require("../report/checks/seo.ts");
    const { checkCrons } = require("../report/checks/crons.ts");
    const { checkCost } = require("../report/checks/cost.ts");
    const { recordCronRun } = require("../../cron/heartbeat.ts");
    await client.user.upsert({ where: { id: "owner" }, update: { plan: "free" }, create: { id: "owner", email: "owner@example.com", passwordHash: "x", plan: "free" } });

    await t.test("광고: 켜진 그룹·키워드·소재가 서로 다른 그룹이면 노출 경로 없음, 같은 그룹이면 노출 가능", async () => {
      const acc = await client.adAccount.create({ data: {
        ownerId: "owner", naverCustomerId: "1234567", label: "베스트라", apiKeyEnc: BLOB, secretKeyEnc: BLOB + "S", keyLast4: "1a2b",
        lastGuardAt: hoursAgo(0.2), lastBizmoneyKrw: 100000,
      } });
      const m = (naverId, extra = {}) => ({ ownerId: "owner", adAccountId: acc.id, naverId, name: naverId, ...extra });
      await client.adCampaign.create({ data: m("cmp-1", { userLock: false, lockedBy: null }) });
      await client.adGroup.createMany({ data: [m("grp-A", { parentNaverId: "cmp-1", userLock: false }), m("grp-B", { parentNaverId: "cmp-1", userLock: true })] });
      // 켜진 키워드는 꺼진 그룹 B에, 켜진 소재는 켜진 그룹 A에 → 경로 없음
      await client.adKeyword.create({ data: { ...m("kwd-1", { parentNaverId: "grp-B", userLock: false, inspectStatus: "APPROVED" }), keyword: "전세" } });
      await client.adCreative.create({ data: { ...m("ad-1", { parentNaverId: "grp-A", userLock: false, inspectStatus: "APPROVED" }), headline: "h", description: "d" } });
      let r = await checkAds({ now: NOW }, client);
      assert.equal(r.level, "warn");
      assert.ok(r.lines.some((l) => l.includes("노출 경로 없음")), r.lines.join("\n"));
      assert.ok(r.lines.some((l) => l.includes("성과 기록 없음")), "성과 행이 없으면 0이 아니라 '기록 없음'");

      // 같은 그룹 A에 켜지고 심사 통과한 키워드 추가 → 노출 가능. 이때 어제 성과가 없으면 '수집 안 됨' 주의
      await client.adKeyword.create({ data: { ...m("kwd-2", { parentNaverId: "grp-A", userLock: false, inspectStatus: "APPROVED" }), keyword: "등기" } });
      r = await checkAds({ now: NOW }, client);
      assert.ok(r.lines.some((l) => l.includes("노출 가능")), r.lines.join("\n"));
      assert.ok(r.lines.some((l) => l.includes("노출 중인데 수집 안 됨")));
      assert.equal(r.level, "warn");

      // 심사 반려 키워드만 있으면 경로 없음
      await client.adKeyword.update({ where: { adAccountId_naverId: { adAccountId: acc.id, naverId: "kwd-2" } }, data: { inspectStatus: "DENIED" } }).catch(async () => {
        await client.$executeRaw`UPDATE ad_keywords SET inspect_status = 'DENIED' WHERE naver_id = 'kwd-2'`;
      });
      r = await checkAds({ now: NOW }, client);
      assert.ok(r.lines.some((l) => l.includes("노출 경로 없음")));

      // 어제(KST 12-02) 성과 행이 있으면 숫자로
      await client.adPerformanceDaily.create({ data: { ownerId: "owner", adAccountId: acc.id, entityType: "campaign", naverId: "cmp-1",
        date: new Date("2026-12-02T00:00:00Z"), impCnt: 120, clkCnt: 7, costKrw: 3500, ccnt: 1 } });
      r = await checkAds({ now: NOW }, client);
      assert.ok(r.lines.some((l) => l.includes("노출 120") && l.includes("전환 1")), r.lines.join("\n"));

      // 확장소재(3.6단계): MINTEQ 등록분(created)만 센다 — 만드는 중(creating)은 빼고, 판정 단계는 바꾸지 않는다
      const level = r.level;
      assert.ok(r.lines.some((l) => l.includes("확장소재 있는 그룹 0/2")), r.lines.join("\n"));
      const ext = (type, status) => ({ ownerId: "owner", adAccountId: acc.id, parentNaverId: "grp-A", type, status, content: {} });
      await client.adExtension.create({ data: ext("SUB_LINKS", "creating") });
      assert.ok((await checkAds({ now: NOW }, client)).lines.some((l) => l.includes("확장소재 있는 그룹 0/2")));
      await client.adExtension.create({ data: { ...ext("HEADLINE", "created"), naverId: "ext-1" } });
      r = await checkAds({ now: NOW }, client);
      assert.ok(r.lines.some((l) => l.includes("확장소재 있는 그룹 1/2")), r.lines.join("\n"));
      assert.equal(r.level, level);

      // 감시가 2시간 안 돌면 이상
      await client.adAccount.update({ where: { id: acc.id }, data: { lastGuardAt: hoursAgo(2) } });
      assert.equal((await checkAds({ now: NOW }, client)).level, "error");
    });

    await t.test("GEO: 질문별 주기 — 다른 질문의 성공이 멈춘 질문을 가리지 않고, 첫 수집 전 새 질문은 멈춤이 아니다", async () => {
      const fresh = await client.visibilityQuery.create({ data: { ownerId: "owner", query: "새 질문", engines: ["chatgpt"], frequency: "weekly", createdAt: hoursAgo(5) } });
      let r = await checkGeo({ now: NOW }, client);
      assert.equal(r.level, "ok", r.lines.join("\n")); // 첫 수집 전(생성 5시간)
      const old = await client.visibilityQuery.create({ data: { ownerId: "owner", query: "오래된 질문", engines: ["chatgpt"], frequency: "weekly", createdAt: hoursAgo(24 * 30) } });
      await client.visibilitySnapshot.create({ data: { queryId: old.id, engine: "chatgpt", status: "ok", capturedAt: hoursAgo(24 * 10) } });
      await client.visibilitySnapshot.create({ data: { queryId: fresh.id, engine: "chatgpt", status: "ok", capturedAt: hoursAgo(1) } });
      r = await checkGeo({ now: NOW }, client);
      assert.equal(r.level, "error", r.lines.join("\n")); // 오래된 질문은 10일째 — 새 질문의 성공이 가리지 않는다
      assert.ok(r.lines.some((l) => l.includes("주기 넘김 1/2")));
      // 수집 기록이 아예 없는 오래된 쌍: 실패도 없으면 주의(엔진 추가 직후), 최근 실패가 있으면 이상
      const added = await client.visibilityQuery.create({ data: { ownerId: "owner", query: "엔진 추가", engines: ["gemini"], frequency: "weekly", createdAt: hoursAgo(24 * 20) } });
      const g = (await checkGeo({ now: NOW }, client)).lines.find((l) => l.startsWith("Gemini"));
      assert.ok(g.includes("수집 기록 없음 1") && !g.includes("주기 넘김"), g);
      await client.visibilitySnapshot.create({ data: { queryId: added.id, engine: "gemini", status: "failed", failReason: "vendor_payment_required", capturedAt: hoursAgo(2) } });
      const g2 = (await checkGeo({ now: NOW }, client)).lines.find((l) => l.startsWith("Gemini"));
      assert.ok(g2.includes("주기 넘김 1/1"), g2);
      await client.visibilityQuery.update({ where: { id: added.id }, data: { active: false } });
      // 60일 조회 범위 밖에만 성공이 있고 최근 실패도 없으면 '첫 수집 전'이 아니라 장기 정지
      const ancient = await client.visibilityQuery.create({ data: { ownerId: "owner", query: "아주 오래된", engines: ["perplexity"], frequency: "weekly", createdAt: hoursAgo(24 * 120) } });
      await client.visibilitySnapshot.create({ data: { queryId: ancient.id, engine: "perplexity", status: "ok", capturedAt: hoursAgo(24 * 90) } });
      const pl = (await checkGeo({ now: NOW }, client)).lines.find((l) => l.startsWith("Perplexity"));
      assert.ok(pl.includes("주기 넘김 1/1") && !pl.includes("수집 기록 없음"), pl);
      await client.visibilityQuery.update({ where: { id: ancient.id }, data: { active: false } });
      // 매일 질문은 2일 기준
      await client.visibilityQuery.update({ where: { id: old.id }, data: { frequency: "daily" } });
      await client.visibilitySnapshot.create({ data: { queryId: old.id, engine: "chatgpt", status: "ok", capturedAt: hoursAgo(30) } });
      assert.equal((await checkGeo({ now: NOW }, client)).level, "ok");
    });

    await t.test("SEO: 제출된 작업이 2시간 넘게 안 바뀌면 수거 멈춤(이상)", async () => {
      const domain = await client.domain.create({ data: { ownerId: "owner", url: "example.com" } });
      const audit = await client.seoAudit.create({ data: { domainId: domain.id, scope: "full", runKey: "rk", configHash: "h", frozenConfig: {}, status: "pending" } });
      const task = await client.seoTask.create({ data: { auditId: audit.id, ownerId: "owner", operation: "serp", itemKey: "k", runKey: "t1", frozenInput: {}, status: "submitted" } });
      assert.notEqual((await checkSeo({ now: new Date() }, client)).level, "error"); // 방금 제출
      await client.$executeRaw`UPDATE seo_tasks SET updated_at = (now() AT TIME ZONE 'UTC') - interval '3 hours' WHERE id = ${task.id}`;
      const r = await checkSeo({ now: new Date() }, client);
      assert.equal(r.level, "error", r.lines.join("\n"));
      assert.ok(r.lines.some((l) => l.includes("수거가 2시간 넘게 멈춘 작업 1건")));
    });

    await t.test("크론: 실행 기록(성공·건너뜀·실패)과 멈춤 판정", async () => {
      const at = (h) => new Date(NOW.getTime() - h * 3600000);
      for (const name of ["ads-guard", "ads-inspect", "seo-resume", "schedule-publish"]) await recordCronRun(name, "succeeded", undefined, at(0.3));
      for (const name of ["ads-stats", "content-generate", "visibility-track"]) await recordCronRun(name, "succeeded", undefined, at(10));
      for (const name of ["strategy-refresh", "topics-refresh"]) await recordCronRun(name, "skipped", "automation_paused", at(24 * 3));
      // ops-report는 아직 기록이 없지만 실행 기록이 처음 생긴 지(3일) 26시간이 지났다 → 멈춤. 기록을 남기면 정상.
      let r = await checkCrons({ now: NOW }, client);
      assert.ok(r.lines.some((l) => l.includes("운영 아침 보고서") && l.includes("멈춤")), r.lines.join("\n"));
      await recordCronRun("ops-report", "succeeded", undefined, at(24));
      r = await checkCrons({ now: NOW }, client);
      assert.equal(r.level, "ok", r.lines.join("\n"));
      // 같은 날 두 번째 실행은 행을 늘리지 않고 갱신(attempts 증가)
      await recordCronRun("ads-guard", "succeeded", undefined, at(0.2));
      const rows = await client.pipelineRun.findMany({ where: { kind: "cron", scopeKey: "ads-guard" } });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].attempts, 2);
      // 마지막 실행이 실패면 주의
      await recordCronRun("seo-resume", "failed", "vendor_unavailable", at(0.1));
      r = await checkCrons({ now: NOW }, client);
      assert.equal(r.level, "warn");
      assert.ok(r.lines.some((l) => l.includes("vendor_unavailable")));
      // 90분 넘게 안 돈 감시 → 멈춤
      r = await checkCrons({ now: new Date(NOW.getTime() + 2 * 3600000) }, client);
      assert.equal(r.level, "error");
      assert.ok(r.lines.some((l) => l.includes("광고 지출 감시") && l.includes("멈춤")));
    });

    await t.test("크론 래퍼: HTTP 200이어도 내부 실패가 있으면 실패로 기록하고 정상 실행 시각은 갱신하지 않는다", async () => {
      const { adsCronRequest } = require("../../ads/cron-http.ts");
      process.env.CRON_SECRET = "cron-secret-test";
      const req = (path) => new Request(`https://m.example${path}`, { headers: { authorization: "Bearer cron-secret-test" } });
      let res = await adsCronRequest(req("/api/cron/ads-inspect"), async () => ({ accounts: [{ accountId: "a", outcome: "ok" }] }));
      assert.equal(res.status, 200);
      res = await adsCronRequest(req("/api/cron/ads-inspect"), async () => ({ accounts: [{ accountId: "a", outcome: "error", reason: "ads_auth_failed" }] }));
      assert.equal(res.status, 200);
      const [row] = await client.pipelineRun.findMany({ where: { kind: "cron", scopeKey: "ads-inspect" } });
      assert.equal(row.status, "failed");
      assert.equal(row.errorCode, "items_failed:1");
      assert.ok(row.resultRef.lastRunAt && row.resultRef.lastFailAt && row.resultRef.lastFailAt > row.resultRef.lastRunAt);
      // 인증 실패는 기록하지 않는다
      const before = await client.pipelineRun.count({ where: { kind: "cron" } });
      res = await adsCronRequest(new Request("https://m.example/api/cron/ads-stats"), async () => ({}));
      assert.equal(res.status, 401);
      assert.equal(await client.pipelineRun.count({ where: { kind: "cron" } }), before);
    });

    await t.test("비용: 지출이 적어도 한도(플랜·예산 중 작은 값) 80%를 넘으면 주의, 예산 0원인데 비용이 나면 주의", async () => {
      await client.costLedger.create({ data: { ownerId: "owner", kind: "chat", krw: 9000, occurredAt: hoursAgo(1) } }); // free 1만 원 한도의 90%
      let r = await checkCost({ now: NOW }, client);
      assert.equal(r.level, "warn", r.lines.join("\n"));
      await client.user.create({ data: { id: "zero", email: "zero@example.com", passwordHash: "x", plan: "pro" } });
      await client.setting.create({ data: { ownerId: "zero", budgetMonthly: 0 } }).catch(() => {});
      await client.costLedger.create({ data: { ownerId: "zero", kind: "chat", krw: 10, occurredAt: hoursAgo(1) } });
      r = await checkCost({ now: NOW }, client);
      assert.ok(r.lines.some((l) => l.includes("zero@example.com")), r.lines.join("\n"));
    });
  } finally {
    await env.close();
  }
});
