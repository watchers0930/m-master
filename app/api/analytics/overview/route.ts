import { jsonError, jsonOk } from "@/lib/api-response";
import { fetchGa4Overview, isGa4Configured } from "@/lib/ga4";
import { logger } from "@/server/logger";

function clampRangeDays(value: number) {
  if (!Number.isFinite(value)) return 30;
  return Math.min(365, Math.max(7, Math.round(value)));
}

export async function GET(request: Request) {
  if (!isGa4Configured()) {
    return jsonError(
      "GA4 환경변수가 설정되지 않았습니다. GA4_PROPERTY_ID, GA4_OAUTH_CLIENT_ID, GA4_OAUTH_CLIENT_SECRET, GA4_OAUTH_REFRESH_TOKEN을 확인하세요.",
      503,
    );
  }

  try {
    const url = new URL(request.url);
    const rangeDays = clampRangeDays(Number(url.searchParams.get("days") || 30));
    const overview = await fetchGa4Overview(rangeDays);
    return jsonOk(overview);
  } catch (error) {
    logger.error("analytics.overview.failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError(
      error instanceof Error ? error.message : "GA4 통계 조회에 실패했습니다.",
      502,
    );
  }
}
