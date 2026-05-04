import { jsonError, jsonOk } from "@/lib/api-response";
import { logger } from "@/server/logger";
import {
  exportProjectContent,
  ProjectContextApprovalRequiredError,
  ProjectContentNotFoundError,
  ProjectNotFoundError,
} from "@/server/services/project-service";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;

  try {
    const bundle = await exportProjectContent(projectId);
    return jsonOk({ bundle });
  } catch (error) {
    if (error instanceof ProjectNotFoundError || error instanceof ProjectContentNotFoundError) {
      return jsonError(error.message, 404);
    }

    if (error instanceof ProjectContextApprovalRequiredError) {
      return jsonError("컨텍스트 승인이 끝난 프로젝트만 콘텐츠를 내보낼 수 있습니다.", 409);
    }

    logger.error("projects.export.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("콘텐츠 내보내기에 실패했습니다.", 500);
  }
}
