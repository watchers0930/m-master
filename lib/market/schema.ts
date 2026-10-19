import { z } from "zod";
import { MARKETS } from "./constants";
export const marketSchema = z.enum(MARKETS);
export const engineSchema = z.enum([
  "chatgpt",
  "ai_overviews",
  "perplexity",
  "gemini",
]);
