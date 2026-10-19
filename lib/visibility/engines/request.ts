import { MARKET_LOCATIONS } from "@/lib/market/constants";
import type { EngineId, Market } from "@/types/visibility";

/** Endpoint contracts checked against DataForSEO documentation on 2026-10-19.
 * Scraper APIs take keyword/location/language, not the LLM Responses model options.
 * https://docs.dataforseo.com/v3/ai_optimization/chat_gpt/llm_scraper/task_post/
 * https://docs.dataforseo.com/v3/ai_optimization-gemini-llm_scraper-task_post/
 */
export function engineRequest(id: EngineId, query: string, market: Market) {
  const location = MARKET_LOCATIONS[market];
  switch (id) {
    case "chatgpt":
    case "gemini":
    case "ai_overviews":
      return {
        keyword: query,
        location_code: location.location_code,
        language_code: location.language_code,
      };
    case "perplexity":
      return {
        user_prompt: query,
        model_name: "sonar",
        web_search: true,
        web_search_country_iso_code: location.country,
      };
  }
}
