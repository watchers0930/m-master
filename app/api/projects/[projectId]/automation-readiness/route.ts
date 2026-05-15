import { jsonError, jsonOk } from "@/lib/api-response";
import { logger } from "@/server/logger";
import { getProjectAutomationReadiness, ProjectNotFoundError } from "@/server/services/project-service";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;

  try {
    const readiness = await getProjectAutomationReadiness(projectId);
    return jsonOk({ readiness });
  } catch (error) {
    if (error instanceof ProjectNotFoundError) {
      return jsonError(error.message, 404);
    }

    logger.error("projects.automation_readiness.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("자동화 준비도 점검을 불러오지 못했습니다.", 500);
  }
}
