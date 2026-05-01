import { jsonError, jsonOk } from "@/lib/api-response";
import { logger } from "@/server/logger";
import {
  ProjectContextApprovalRequiredError,
  markProjectReadyForPublish,
  ProjectContentNotFoundError,
  ProjectNotFoundError,
} from "@/server/services/project-service";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;

  try {
    const publish = await markProjectReadyForPublish(projectId);
    return jsonOk({ publish });
  } catch (error) {
    if (error instanceof ProjectNotFoundError || error instanceof ProjectContentNotFoundError) {
      return jsonError(error.message, 404);
    }

    if (error instanceof ProjectContextApprovalRequiredError) {
      return jsonError("컨텍스트 승인이 끝난 프로젝트만 발행 준비를 진행할 수 있습니다.", 409);
    }

    logger.error("projects.publish.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("발행 준비 처리에 실패했습니다.", 500);
  }
}
