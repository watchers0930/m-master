import type { VendorEnvelope } from "@/lib/external/dataforseo";
import { checkpointSchema, object, type FrozenInput } from "./types";
import { metricInput } from "./metric-contract";
import { metricRows, monthlyRows, uniqueIssues } from "./metric-response";
export function demandRequest(input: FrozenInput) {
  // Historical Labs has no date filter: targetPeriod is applied to normalized observations.
  return { path: "dataforseo_labs/google/historical_search_volume/live", body: [metricInput(input)], units: input.units! };
}
export function parseDemand(response: VendorEnvelope, input: FrozenInput) {
  const {rows, issues} = metricRows(response, input, true);
  const p = input.targetPeriod;
  if (!p) throw new Error("missing_metric_period");
  const expected = p.toYear*12+p.toMonth-(p.fromYear*12+p.fromMonth)+1;
  const demandPoints = rows.flatMap(r => {
    const months = monthlyRows(object(r.keyword_info).monthly_searches, issues, input);
    if (months.length < expected) issues.push("missing_target_months");
    return months.map(m => ({...m, keyword: r.keyword, location: input.location}));
  });
  if (!demandPoints.length) issues.push("no_observed_months");
  return checkpointSchema.parse({demandPoints, issues: uniqueIssues(issues)});
}
