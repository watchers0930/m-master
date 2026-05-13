import { jsonError, jsonOk } from "@/lib/api-response";
import {
  fetchGa4Overview,
  isGa4Configured,
  parseGa4ServiceAccountJson,
  type Ga4ServiceAccountJson,
} from "@/lib/ga4";
import { logger } from "@/server/logger";

function clampRangeDays(value: number) {
  if (!Number.isFinite(value)) return 30;
  return Math.min(365, Math.max(7, Math.round(value)));
}

export async function GET(request: Request) {
  if (!isGa4Configured()) {
    return jsonError(
      "GA4 서버 설정이 없습니다. Property ID와 서비스 계정 JSON을 업로드하거나 서버 환경변수를 확인하세요.",
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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      days?: number;
      propertyId?: string;
      serviceAccountJson?: string | Ga4ServiceAccountJson;
    };

    const propertyId = body.propertyId?.trim();
    if (!propertyId) {
      return jsonError("Property ID를 입력하세요.", 400);
    }

    if (!body.serviceAccountJson) {
      return jsonError("서비스 계정 JSON 파일을 첨부하세요.", 400);
    }

    const parsed = parseGa4ServiceAccountJson(body.serviceAccountJson);
    const overview = await fetchGa4Overview(clampRangeDays(Number(body.days) || 30), {
      ...parsed,
      propertyId,
    });

    return jsonOk(overview);
  } catch (error) {
    logger.error("analytics.overview.upload.failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError(
      error instanceof Error ? error.message : "GA4 통계 조회에 실패했습니다.",
      502,
    );
  }
}
