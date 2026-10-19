import { createEngine } from "./factory";
// No automatic paid fallback: a no-mention result must not trigger another charge.
export const chatgpt = createEngine(
  "chatgpt",
  "ai_optimization/chat_gpt/llm_scraper/task_post",
  "llm_scraper",
);
