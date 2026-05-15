import { jsonOk } from "@/lib/api-response";
import { fetchGa4Health } from "@/lib/ga4";
import { logger } from "@/server/logger";

function clampRangeDays(value: number) {
  if (!Number.isFinite(value)) return 7;
  return Math.min(30, Math.max(1, Math.round(value)));
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  try {
    const rangeDays = clampRangeDays(Number(url.searchParams.get("days") || 7));
    const health = await fetchGa4Health(rangeDays);
    return jsonOk(health);
  } catch (error) {
    logger.error("analytics.health.failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonOk({
      generatedAt: new Date().toISOString(),
      rangeDays: 7,
      sources: [],
      globalIssue:
        error instanceof Error ? error.message : "GA4 헬스체크를 불러오지 못했습니다.",
    });
  }
}
