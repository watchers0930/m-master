import { jsonError, jsonOk } from "../../../../../../lib/api-response";
import { logger } from "../../../../../../server/logger";
import {
  addCmsItem,
  CmsSectionNotFoundError,
} from "../../../../../../server/services/cms-service";
import {
  CmsValidationError,
  parseItemCreateInput,
} from "../../../../../../server/validators/cms-validator";

type RouteContext = {
  params: Promise<{
    sectionId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { sectionId } = await context.params;

  try {
    const input = await parseItemCreateInput(request);
    const sections = await addCmsItem({
      sectionId,
      ...input,
    });

    return jsonOk({ sections }, { status: 201 });
  } catch (error) {
    if (error instanceof CmsValidationError) {
      return jsonError(error.message, 400);
    }

    if (error instanceof CmsSectionNotFoundError) {
      return jsonError(error.message, 404);
    }

    logger.error("cms.item.create.failed", {
      sectionId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("CMS 항목을 생성하지 못했습니다.", 500);
  }
}
