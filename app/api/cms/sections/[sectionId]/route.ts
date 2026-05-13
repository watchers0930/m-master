import { jsonError, jsonOk } from "../../../../../lib/api-response";
import { revalidatePath } from "next/cache";
import { logger } from "../../../../../server/logger";
import {
  CmsSectionNotFoundError,
  saveCmsSection,
} from "../../../../../server/services/cms-service";
import {
  CmsValidationError,
  parseSectionUpdateInput,
} from "../../../../../server/validators/cms-validator";

type RouteContext = {
  params: Promise<{
    sectionId: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { sectionId } = await context.params;

  try {
    const input = await parseSectionUpdateInput(request);
    const sections = await saveCmsSection({
      sectionId,
      ...input,
    });
    revalidatePath("/");
    revalidatePath("/cms");

    return jsonOk({ sections });
  } catch (error) {
    if (error instanceof CmsValidationError) {
      return jsonError(error.message, 400);
    }

    if (error instanceof CmsSectionNotFoundError) {
      return jsonError(error.message, 404);
    }

    logger.error("cms.section.update.failed", {
      sectionId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("CMS 섹션을 저장하지 못했습니다.", 500);
  }
}
