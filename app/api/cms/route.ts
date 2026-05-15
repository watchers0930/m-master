import { jsonError, jsonOk } from "../../../lib/api-response";
import { logger } from "../../../server/logger";
import { getCmsSections } from "../../../server/services/cms-service";

export async function GET() {
  try {
    const sections = await getCmsSections();
    return jsonOk({ sections });
  } catch (error) {
    logger.error("cms.sections.list.failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("CMS 섹션을 불러오지 못했습니다.", 500);
  }
}
