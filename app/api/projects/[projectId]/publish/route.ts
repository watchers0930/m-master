import { jsonError, jsonOk } from "@/lib/api-response";
import { logger } from "@/server/logger";
import {
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

    logger.error("projects.publish.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("발행 준비 처리에 실패했습니다.", 500);
  }
}
