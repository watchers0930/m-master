import { createEngine } from "./factory";
export const perplexity = createEngine(
  "perplexity",
  "ai_optimization/perplexity/llm_responses/live",
  "passthrough",
);
