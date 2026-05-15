import { jsonError, jsonOk } from "@/lib/api-response";
import { logger } from "@/server/logger";
import {
  adoptProjectVariant,
  ProjectNotFoundError,
} from "@/server/services/project-service";
import { parseVariantAdoptInput } from "@/server/validators/content-job-validator";
import { ProjectValidationError } from "@/server/validators/project-validator";

type RouteContext = {
  params: Promise<{
    projectId: string;
    variantId: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { projectId, variantId } = await context.params;

  try {
    const input = await parseVariantAdoptInput(request);

    if (!input.adopted) {
      return jsonError("adopted: true만 지원합니다.", 400);
    }

    const studio = await adoptProjectVariant(projectId, variantId);

    return jsonOk({ studio });
  } catch (error) {
    if (error instanceof ProjectValidationError) {
      return jsonError(error.message, 400);
    }

    if (error instanceof ProjectNotFoundError) {
      return jsonError(error.message, 404);
    }

    logger.error("projects.variants.adopt.failed", {
      projectId,
      variantId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("버전 채택에 실패했습니다.", 500);
  }
}
