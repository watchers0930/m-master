import type { VendorEnvelope } from "@/lib/external/dataforseo";
import { checkpointSchema, type FrozenInput } from "./types";
import { adsSchema, metricInput } from "./metric-contract";
import { metricRows, monthlyRows, uniqueIssues } from "./metric-response";
export function adsRequest(input: FrozenInput) {
  return { path: "keywords_data/google_ads/search_volume/live", body: [metricInput(input)], units: input.units! };
}
export function parseAds(response: VendorEnvelope, input: FrozenInput) {
  const {rows, issues} = metricRows(response, input, false);
  const adsMetrics = rows.map(r => {
    const parse = <T>(schema: {safeParse(v: unknown): {success: true; data: T} | {success: false}}, value: unknown): T | null => {
      const result = schema.safeParse(value ?? null);
      if (!result.success || result.data === null) issues.push("missing_or_invalid_ads_metric");
      return result.success ? result.data : null;
    };
    return {keyword: r.keyword, cpc: parse(adsSchema.shape.cpc, r.cpc),
      adCompetition: parse(adsSchema.shape.adCompetition, r.competition),
      searchVolume: parse(adsSchema.shape.searchVolume, r.search_volume),
      // Google Ads search_volume CPC is denominated in USD by contract.
      currency: parse(adsSchema.shape.currency, r.currency ?? "USD"), monthly: monthlyRows(r.monthly_searches, issues)};
  });
  return checkpointSchema.parse({adsMetrics, issues: uniqueIssues(issues)});
}
