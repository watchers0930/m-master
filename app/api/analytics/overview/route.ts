import { jsonError, jsonOk } from "@/lib/api-response";
import { isGa4Configured, listGa4Sources } from "@/lib/ga4";
import { fetchSourceOverview } from "@/lib/source-analytics";
import { logger } from "@/server/logger";

function clampRangeDays(value: number) {
  if (!Number.isFinite(value)) return 30;
  return Math.min(365, Math.max(7, Math.round(value)));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sourceId = url.searchParams.get("source")?.trim() || undefined;

  if (!isGa4Configured(sourceId)) {
    const configuredSources = listGa4Sources();
    return jsonError(
      configuredSources.length > 0
        ? `GA4 source '${sourceId || "unknown"}' 가 설정되지 않았습니다.`
        : "GA4 환경변수가 설정되지 않았습니다. GA4_PROPERTY_ID, GA4_OAUTH_CLIENT_ID, GA4_OAUTH_CLIENT_SECRET, GA4_OAUTH_REFRESH_TOKEN 또는 GA4_SOURCE_* 세트를 확인하세요.",
      503,
    );
  }

  try {
    const rangeDays = clampRangeDays(Number(url.searchParams.get("days") || 30));
    const overview = await fetchSourceOverview(rangeDays, sourceId);
    return jsonOk(overview);
  } catch (error) {
    logger.error("analytics.overview.failed", {
      sourceId: sourceId || "default",
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError(
      error instanceof Error ? error.message : "GA4 통계 조회에 실패했습니다.",
      502,
    );
  }
}
