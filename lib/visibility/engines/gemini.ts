import { createEngine } from "./factory";
export const gemini = createEngine(
  "gemini",
  "ai_optimization/gemini/llm_scraper/task_post",
  "llm_scraper",
);
