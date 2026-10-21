import type { VendorEnvelope } from "@/lib/external/dataforseo";
import { checkpointSchema, type FrozenInput } from "./types";
import { difficultySchema, metricInput } from "./metric-contract";
import { metricRows, uniqueIssues } from "./metric-response";
export function difficultyRequest(input: FrozenInput) {
  return { path: "dataforseo_labs/google/bulk_keyword_difficulty/live", body: [metricInput(input)], units: input.units! };
}
export function parseDifficulty(response: VendorEnvelope, input: FrozenInput) {
  const {rows, issues} = metricRows(response, input, true);
  const difficulties = rows.map(r => {
    const parsed = difficultySchema.safeParse({keyword: r.keyword, difficulty: r.keyword_difficulty ?? null});
    if (!parsed.success || parsed.data.difficulty === null) issues.push("missing_or_invalid_difficulty");
    return {keyword: String(r.keyword), difficulty: parsed.success ? parsed.data.difficulty : null};
  });
  return checkpointSchema.parse({difficulties, issues: uniqueIssues(issues)});
}
