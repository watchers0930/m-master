import { DataForSeoClient, DataForSeoError } from "@/lib/external/dataforseo";
import { MARKET_ENGINES } from "@/lib/market/constants";
import type { EngineId, VisibilityEngine } from "./types";
import { normalizeVendor } from "./parse";
import { engineRequest } from "./request";
export function createEngine(
  id: EngineId,
  path: string,
  source: string,
): VisibilityEngine {
  return {
    id,
    source,
    supportsMarket: (market) => MARKET_ENGINES[market]?.includes(id) ?? false,
    async capture(query, market, context) {
      if (!MARKET_ENGINES[market]?.includes(id))
        throw new DataForSeoError("unsupported_market");
      const body = engineRequest(id, query, market);
      let costKrw = 0;
      const response = await new DataForSeoClient().task(path, [body], {
        ...context,
        onTask: async (taskId, cost, result) => {
          costKrw = cost;
          await context.onTask?.(taskId, cost, result);
        },
      });
      try {
        return { ...normalizeVendor(id, source, response), costKrw };
      } catch {
        throw new DataForSeoError(
          "vendor_invalid_response",
          costKrw,
          response.tasks?.[0]?.id ?? undefined,
        );
      }
    },
  };
}
