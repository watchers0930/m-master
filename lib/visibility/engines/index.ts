import { chatgpt } from "./chatgpt";
import { gemini } from "./gemini";
import { perplexity } from "./perplexity";
import { aiOverviews } from "./ai-overviews";
import { naverAiBriefing } from "./naver-ai-briefing";
import type { EngineId, VisibilityEngine } from "./types";
const engines: Record<EngineId, VisibilityEngine> = {
  chatgpt,
  gemini,
  perplexity,
  ai_overviews: aiOverviews,
  naver_ai_briefing: naverAiBriefing,
};
export function getEngine(id: EngineId): VisibilityEngine {
  return engines[id];
}
