// lib/ads/managed-keywords.ts — 네이버 판매 금지 키워드 조회(GET /ncc/managedKeyword, 읽기 전용·무료).
// 실운영 2026-11-12: 판매 금지 키워드(isSellProhibit) 생성 POST에 네이버가 성공 코드로 답하고 등록하지 않음 → 적용이 '불확실'로 영구히 멈췄다.
// - 제안 생성: 키워드 도구 결과에서 미리 뺀다(dropSellProhibited). 조회 실패는 거르지 않고 진행(적용 단계가 다시 막는다). 키 무효만 그대로 던진다.
// - 적용: 키워드 단계 전에 sellProhibitedKeywords로 조회한다. 실패는 그대로 던져 키워드 POST 없이 멈춘다(apply.ts).
// 비교 키는 prohibitedKey = NFC 정규화(collapseKeyword) 뒤 keywordDedupeKey(공백 제거·소문자) — 네이버가 NFD로 돌려줘도 같은 키(codex MED-1). 묶음 크기 100(실측 2026-11-12: 200개 한 번에도 정상 — 보수적으로 절반).
import { NaverAdsError, type NaverAdsClient } from "@/lib/external/naver-searchad";
import { naverManagedKeywordListSchema } from "@/schemas/ads";
import type { KeywordStat } from "./keywords";
import { collapseKeyword, keywordDedupeKey } from "./keyword-text";
import { unexpectedNaverResponse } from "./http";

const BATCH = 100;

/** 판매 금지 집합 비교 키(조회 결과·제안 키워드 양쪽에 같은 함수를 쓴다). */
export const prohibitedKey = (text: string): string => keywordDedupeKey(collapseKeyword(text));
type ManagedClient = Pick<NaverAdsClient, "get">;

/** 입력 키워드 중 판매 금지인 것의 비교 키 집합. 네이버가 답하지 않은 키워드는 판매 금지로 보지 않는다. */
export async function sellProhibitedKeywords(client: ManagedClient, keywords: readonly string[]): Promise<Set<string>> {
  const unique = [...new Map(keywords.map((k) => [prohibitedKey(k), k])).values()];
  const prohibited = new Set<string>();
  for (let i = 0; i < unique.length; i += BATCH) {
    const parsed = naverManagedKeywordListSchema.safeParse(await client.get("/ncc/managedKeyword", { keywords: unique.slice(i, i + BATCH).join(",") }));
    if (!parsed.success) throw unexpectedNaverResponse();
    for (const row of parsed.data) if (row.managedKeyword?.isSellProhibit === true) prohibited.add(prohibitedKey(row.keyword));
  }
  return prohibited;
}

/** 제안 생성용: 판매 금지 키워드를 뺀 통계. 조회 실패는 경고만 남기고 그대로 돌려준다(키 무효는 다시 던진다). */
export async function dropSellProhibited(client: ManagedClient, stats: KeywordStat[]): Promise<KeywordStat[]> {
  try {
    const prohibited = await sellProhibitedKeywords(client, stats.map((s) => s.keyword));
    return prohibited.size ? stats.filter((s) => !prohibited.has(prohibitedKey(s.keyword))) : stats;
  } catch (error) {
    if (error instanceof NaverAdsError && error.reason === "ads_auth_failed") throw error;
    console.warn("[ads] sell-prohibited check failed; proposal keeps unchecked keywords", { error: error instanceof Error ? error.name : "unknown" });
    return stats;
  }
}
