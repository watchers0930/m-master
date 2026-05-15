import { jsonError, jsonOk } from "@/lib/api-response";
import {
  adaptFirstPartyOverview,
  isFirstPartyOverviewResponse,
  isGa4OverviewResponse,
  normalizeCustomSourceInput,
  type CustomAnalyticsSourceInput,
} from "@/lib/external-analytics";
import { logger } from "@/server/logger";

interface ExternalOverviewRequestBody {
  days?: number;
  source?: CustomAnalyticsSourceInput;
}

function clampRangeDays(value: number) {
  if (!Number.isFinite(value)) return 30;
  return Math.min(365, Math.max(7, Math.round(value)));
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as ExternalOverviewRequestBody | null;
    const source = normalizeCustomSourceInput(body?.source || { label: "", endpointUrl: "" });
    const rangeDays = clampRangeDays(Number(body?.days || 30));
    const endpoint = new URL(source.endpointUrl);
    endpoint.searchParams.set("days", String(rangeDays));

    const response = await fetch(endpoint.toString(), {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(source.accessKey ? { "x-analytics-key": source.accessKey } : {}),
      },
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return jsonError(`외부 집계 소스 조회 실패 (${response.status})`, 502, detail.slice(0, 300));
    }

    const json = await response.json() as unknown;

    if (isGa4OverviewResponse(json)) {
      return jsonOk({
        ...json,
        source: source.id || json.source,
        sourceLabel: source.label,
        notes: [...json.notes, `${source.label} 소스는 사용자 추가 외부 집계로 연결되었습니다.`],
      });
    }

    if (isFirstPartyOverviewResponse(json)) {
      return jsonOk(adaptFirstPartyOverview(source, json));
    }

    return jsonError("지원하지 않는 집계 응답 형식입니다.", 422);
  } catch (error) {
    logger.error("analytics.external_overview.failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError(
      error instanceof Error ? error.message : "외부 집계 조회에 실패했습니다.",
      400,
    );
  }
}
