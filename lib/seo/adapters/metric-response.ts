import type { VendorEnvelope } from "@/lib/external/dataforseo";
import { array, object, type FrozenInput } from "./types";
import { metricInput, monthSchema, normalizeMetricKeyword } from "./metric-contract";
export function metricRows(response: VendorEnvelope, input: FrozenInput, nested: boolean) {
  metricInput(input);
  const results = response.tasks?.flatMap(t => t.result ?? []) ?? [];
  const rows = nested ? results.flatMap(r => array(object(r).items)) : results;
  const wanted = new Set(input.keywords), seen = new Set<string>(), issues: string[] = [];
  const accepted: Record<string, unknown>[] = [];
  for (const value of rows) {
    const row = object(value);
    const key = typeof row.keyword === "string" ? normalizeMetricKeyword(row.keyword) : "";
    if (!wanted.has(key)) { issues.push("unexpected_keyword"); continue; }
    if (seen.has(key)) { issues.push("duplicate_keyword"); continue; }
    seen.add(key);
    if (row.location_code !== undefined && row.location_code !== input.location) { issues.push("location_mismatch"); continue; }
    accepted.push({ ...row, keyword: key });
  }
  for (const key of wanted) if (!seen.has(key)) issues.push("missing_keyword");
  if (!rows.length) issues.push("empty_result");
  return { rows: accepted, issues };
}
export function monthlyRows(raw: unknown, issues: string[], input?: FrozenInput) {
  if (raw == null) { issues.push("missing_months"); return []; }
  if (!Array.isArray(raw)) { issues.push("invalid_months"); return []; }
  const seen = new Set<string>();
  const rows = [];
  for (const value of raw) {
    const m = object(value);
    const parsed = monthSchema.safeParse({ year: m.year, month: m.month, volume: m.search_volume });
    if (!parsed.success) { issues.push("invalid_month"); continue; }
    const key = `${m.year}-${m.month}`;
    if (seen.has(key)) { issues.push("duplicate_month"); continue; }
    seen.add(key);
    const p = input?.targetPeriod;
    const index = parsed.data.year * 12 + parsed.data.month;
    if (p && (index < p.fromYear * 12 + p.fromMonth || index > p.toYear * 12 + p.toMonth)) continue;
    rows.push(parsed.data);
  }
  return rows.sort((a,b) => a.year-b.year || a.month-b.month);
}
// Keep reasons bounded while retaining each failure class.
export const uniqueIssues = (issues: string[]) => [...new Set(issues)].sort();
