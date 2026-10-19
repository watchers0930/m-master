import type { Market, EngineId, EngineResult } from "@/types/visibility";
import type { RunContext } from "@/lib/external/dataforseo";
export type { EngineId, EngineResult, Citation } from "@/types/visibility";
export interface VisibilityEngine {
  id: EngineId;
  source: string;
  supportsMarket(market: Market): boolean;
  capture(
    query: string,
    market: Market,
    context: RunContext,
  ): Promise<EngineResult>;
}
