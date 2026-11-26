import type { EngineId, Market } from "@/types/visibility";
export { MARKETS, DEFAULT_MARKET } from "@/types/visibility";
export const ENGINE_IDS: EngineId[] = [
  "chatgpt",
  "ai_overviews",
  "perplexity",
  "gemini",
  "naver_ai_briefing",
];
/** 네이버 AI 브리핑은 한국 시장 전용(SerpApi naver 엔진은 지역 파라미터가 없다). */
const GLOBAL_ENGINES = ENGINE_IDS.filter((id) => id !== "naver_ai_briefing");
export const MARKET_ENGINES: Record<Market, EngineId[]> = {
  "ko-KR": [...ENGINE_IDS],
  "en-US": [...GLOBAL_ENGINES],
  "en-GB": [...GLOBAL_ENGINES],
  "en-CA": [...GLOBAL_ENGINES],
  "en-AU": [...GLOBAL_ENGINES],
};
export const MARKET_LOCATIONS: Record<
  Market,
  { location_code: number; language_code: string; country: string }
> = {
  "ko-KR": { location_code: 2410, language_code: "ko", country: "KR" },
  "en-US": { location_code: 2840, language_code: "en", country: "US" },
  "en-GB": { location_code: 2826, language_code: "en", country: "GB" },
  "en-CA": { location_code: 2124, language_code: "en", country: "CA" },
  "en-AU": { location_code: 2036, language_code: "en", country: "AU" },
};
