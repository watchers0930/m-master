import { chatgpt } from "./chatgpt";
import { gemini } from "./gemini";
import { perplexity } from "./perplexity";
import { aiOverviews } from "./ai-overviews";
import type { EngineId, VisibilityEngine } from "./types";
const engines: Record<EngineId, VisibilityEngine> = {
  chatgpt,
  gemini,
  perplexity,
  ai_overviews: aiOverviews,
};
export function getEngine(id: EngineId): VisibilityEngine {
  return engines[id];
}
