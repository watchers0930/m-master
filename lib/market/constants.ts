import type { EngineId, Market } from "@/types/visibility";
export { MARKETS, DEFAULT_MARKET } from "@/types/visibility";
export const ENGINE_IDS: EngineId[] = [
  "chatgpt",
  "ai_overviews",
  "perplexity",
  "gemini",
];
export const MARKET_ENGINES: Record<Market, EngineId[]> = {
  "ko-KR": [...ENGINE_IDS],
  "en-US": [...ENGINE_IDS],
  "en-GB": [...ENGINE_IDS],
  "en-CA": [...ENGINE_IDS],
  "en-AU": [...ENGINE_IDS],
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
