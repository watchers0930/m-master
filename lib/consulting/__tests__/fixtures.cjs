/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, module */
const { completedRange } = require("../input.ts");
const snapshot = { market: "ko-KR", range: completedRange(new Date("2026-10-20T03:00:00Z")),
  evidence: [{ id: "seo_score", source: "seo", label: "Score", value: 70, observedAt: null }],
  sourceStatus: [{ source: "seo", status: "partial", observedAt: null, reason: null }], limitations: [], selection: [], monthlyMarketingBudget: { amount: 101, currency: "KRW" } };
function strategy() {
  const channels = ["organic", "geo", "naver_paid"];
  return { diagnosis: { summary: "현재 점수 {{ev:seo_score}}", strengths: [], issues: [], uncertainties: [] },
    channelMix: channels.map((channel, i) => ({ channel, applicability: "applicable", recommendedRatio: [34,33,33][i], reason: "근거 기반 제안", evidenceIds: ["seo_score"] })),
    budgetProposal: { totalAmount: 101, currency: "KRW", allocations: channels.map((channel, i) => ({ channel, ratio: [34,33,33][i], amount: null })), assumptions: [] },
    priorityActions: [{ id: "audit", priority: "P0", channel: "organic", title: "감사 진행", description: "검증 후 실행", evidenceIds: ["seo_score"], metric: "기술 점수", destination: "seo_audit" }] };
}
module.exports = { strategy, snapshot };
