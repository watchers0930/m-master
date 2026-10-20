import type { SeoCheckResult } from "@/types/seo";
export function technicalScore(
  checks: SeoCheckResult[],
  coefficients: Record<string, number> = {},
) {
  let evaluated = 0,
    quality = 0,
    na = 0;
  for (const check of checks) {
    if (check.status === "not_applicable") {
      na += check.weight;
      continue;
    }
    if (check.status === "unknown") continue;
    evaluated += check.weight;
    quality +=
      check.weight *
      (coefficients[check.key] ??
        (check.status === "pass" ? 1 : check.status === "warning" ? 0.5 : 0));
  }
  return {
    technicalScore: evaluated ? Math.round((100 * quality) / evaluated) : null,
    coverage: 100 - na > 0 ? evaluated / (100 - na) : 0,
    scoreVersion: "v1",
  };
}
