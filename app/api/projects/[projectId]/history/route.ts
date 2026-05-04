import { jsonError, jsonOk } from "@/lib/api-response";
import { logger } from "@/server/logger";
import { getProjectActivity, ProjectNotFoundError } from "@/server/services/project-service";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;

  try {
    const history = await getProjectActivity(projectId);
    return jsonOk({ history });
  } catch (error) {
    if (error instanceof ProjectNotFoundError) {
      return jsonError(error.message, 404);
    }

    logger.error("projects.history.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("작업 이력을 불러오지 못했습니다.", 500);
  }
}
