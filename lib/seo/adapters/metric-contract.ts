import { z } from "zod";
import { MARKET_LOCATIONS } from "@/lib/market/constants";
import type { FrozenInput } from "./types";
// Application safety ceilings, not claims about provider return lengths.
export const NEW_METRIC_KEYWORD_CAP = 50;
export const ADS_MONTHS_CAP = 48;
export const DEMAND_ROWS_PER_CHECKPOINT_CAP = 600;
export const METRIC_OPERATIONS = ["kw_difficulty", "kw_demand", "kw_ads"] as const;
export const isMetricOperation = (operation: string) => METRIC_OPERATIONS.some(v => v === operation);
export const monthSchema = z.strictObject({ year: z.number().int().min(2000).max(2200),
  month: z.number().int().min(1).max(12), volume: z.number().int().min(0).max(2147483647) });
export const difficultySchema = z.strictObject({ keyword: z.string().min(1).max(200), difficulty: z.number().int().min(0).max(100).nullable() });
export const adsSchema = z.strictObject({ keyword: z.string().min(1).max(200), cpc: z.number().finite().nonnegative().nullable(),
  adCompetition: z.enum(["LOW", "MEDIUM", "HIGH"]).nullable(), searchVolume: z.number().int().min(0).max(2147483647).nullable(),
  currency: z.string().min(1).max(10).nullable(), monthly: z.array(monthSchema).max(ADS_MONTHS_CAP) });
export const demandSchema = monthSchema.extend({ keyword: z.string().min(1).max(200), location: z.number().int().positive() });
export function metricInput(input: FrozenInput) {
  const market = MARKET_LOCATIONS[input.market];
  if (!market || input.location !== market.location_code || input.language !== market.language_code ||
      input.engine !== "google" || !input.keywords?.length || input.keywords.length > NEW_METRIC_KEYWORD_CAP ||
      input.keywordIds?.length !== input.keywords.length || new Set(input.keywordIds).size !== input.keywordIds.length ||
      new Set(input.keywords).size !== input.keywords.length || input.units !== input.keywords.length ||
      input.keywords.some(k => !k || k.length > 200 || k !== normalizeMetricKeyword(k))) throw new Error("invalid_metric_input");
  if (input.targetPeriod) {
    const p = input.targetPeriod;
    if (![p.fromYear,p.toYear].every(v=>Number.isInteger(v) && v>=2000 && v<=2200) ||
        ![p.fromMonth,p.toMonth].every(v=>Number.isInteger(v) && v>=1 && v<=12) ||
        p.toYear*12+p.toMonth < p.fromYear*12+p.fromMonth || p.toYear*12+p.toMonth-(p.fromYear*12+p.fromMonth)>=12)
      throw new Error("invalid_metric_period");
  }
  if (!Number.isInteger(input.batchIndex) || input.batchIndex! < 0) throw new Error("invalid_metric_batch");
  return { keywords: input.keywords, location_code: input.location, language_code: input.language };
}
export const normalizeMetricKeyword = (v: string) => v.normalize("NFKC").trim().toLowerCase();
export function metricUnits(operation: string, input: FrozenInput) {
  return isMetricOperation(operation) ? metricInput(input).keywords.length :
    operation === "onpage_crawl" ? 20 : operation === "onpage_instant" ? (input.paths ?? ["/"]).length : operation === "labs_ranked" ? 100 : 1;
}
