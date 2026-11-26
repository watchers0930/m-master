// lib/ops/report/checks/vendors.ts — 외부 데이터 공급사 잔액·한도(조회는 둘 다 무료, 과금·한도 차감 없음).
// 2026-11 DataForSEO 잔액 소진으로 SEO·GEO가 2주 넘게 조용히 멈춘 사고가 이 점검의 이유다.
import { DataForSeoClient } from "@/lib/external/dataforseo";
import { SerpApiClient } from "@/lib/external/serpapi";
import { VendorError } from "@/lib/external/vendor-error";
import type { CheckResult } from "../types";

export const DATAFORSEO_WARN_USD = 5;
export const SERPAPI_WARN_LEFT = 25;

const reasonOf = (error: unknown) => (error instanceof VendorError ? error.reason : "unknown_error");

export async function checkDataForSeo(client: Pick<DataForSeoClient, "balanceUsd"> = new DataForSeoClient()): Promise<CheckResult> {
  const base = { key: "dataforseo", title: "DataForSEO 잔액(SEO·GEO 유료 수집)" };
  try {
    const balance = await client.balanceUsd(Date.now() + 15000);
    const text = `${balance < 0 ? "-" : ""}$${Math.abs(balance).toFixed(2)}`;
    if (balance <= 0)
      return { ...base, level: "error", summary: `잔액 ${text} — SEO 진단·GEO(ChatGPT·Gemini·AI 개요) 수집이 멈춥니다. 충전이 필요합니다.`, lines: [] };
    if (balance < DATAFORSEO_WARN_USD)
      return { ...base, level: "warn", summary: `잔액 ${text} — $${DATAFORSEO_WARN_USD} 미만, 곧 충전이 필요합니다.`, lines: [] };
    return { ...base, level: "ok", summary: `잔액 ${text}`, lines: [] };
  } catch (error) {
    return { ...base, level: "error", summary: `잔액을 조회하지 못했습니다(${reasonOf(error)}).`, lines: [] };
  }
}

export async function checkSerpApi(client: Pick<SerpApiClient, "account"> = new SerpApiClient()): Promise<CheckResult> {
  const base = { key: "serpapi", title: "SerpApi 한도(네이버 AI 브리핑)" };
  try {
    const a = await client.account(Date.now() + 15000);
    const left = a.plan_searches_left;
    if (typeof left !== "number") return { ...base, level: "warn", summary: "남은 횟수를 알 수 없습니다.", lines: [] };
    const used = typeof a.this_month_usage === "number" ? ` · 이번 달 ${a.this_month_usage}회 사용` : "";
    const plan = a.searches_per_month ? `/${a.searches_per_month}` : "";
    const summary = `남은 ${left}${plan}회${used}`;
    if (left <= 0) return { ...base, level: "error", summary: `${summary} — 네이버 AI 브리핑 수집이 멈춥니다.`, lines: [] };
    if (left < SERPAPI_WARN_LEFT) return { ...base, level: "warn", summary: `${summary} — 한도가 얼마 남지 않았습니다.`, lines: [] };
    return { ...base, level: "ok", summary, lines: [] };
  } catch (error) {
    return { ...base, level: "error", summary: `한도를 조회하지 못했습니다(${reasonOf(error)}).`, lines: [] };
  }
}
