import { jsonError, jsonOk } from "@/lib/api-response";
import { logger } from "@/server/logger";
import {
  generateProjectContentVariants,
  getProjectVariantGroup,
  ProjectContextApprovalRequiredError,
  ProjectNotFoundError,
} from "@/server/services/project-service";
import { parseVariantGenerationInput } from "@/server/validators/content-job-validator";
import { ProjectValidationError } from "@/server/validators/project-validator";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;

  try {
    const variantGroup = await getProjectVariantGroup(projectId);
    return jsonOk({ variantGroup });
  } catch (error) {
    if (error instanceof ProjectNotFoundError) {
      return jsonError(error.message, 404);
    }

    logger.error("projects.variants.get.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("버전 그룹 조회에 실패했습니다.", 500);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;

  try {
    const input = await parseVariantGenerationInput(request);

    const variantGroup = await generateProjectContentVariants(
      projectId,
      input.topic,
      input.count,
    );

    return jsonOk({ variantGroup }, { status: 201 });
  } catch (error) {
    if (error instanceof ProjectValidationError) {
      return jsonError(error.message, 400);
    }

    if (error instanceof ProjectNotFoundError) {
      return jsonError(error.message, 404);
    }

    if (error instanceof ProjectContextApprovalRequiredError) {
      return jsonError("컨텍스트 승인이 끝난 프로젝트만 버전을 생성할 수 있습니다.", 409);
    }

    logger.error("projects.variants.create.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("A/B 버전 생성에 실패했습니다.", 500);
  }
}
