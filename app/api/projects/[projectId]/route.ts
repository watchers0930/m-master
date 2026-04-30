import { jsonError, jsonOk } from "../../../../lib/api-response";
import { logger } from "../../../../server/logger";
import { getProjectById, getProjectStudioSeed, ProjectNotFoundError } from "../../../../server/services/project-service";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode");

  try {
    if (mode === "studio") {
      const studio = await getProjectStudioSeed(projectId);
      return jsonOk({ studio });
    }

    const project = await getProjectById(projectId);
    return jsonOk({ project });
  } catch (error) {
    if (error instanceof ProjectNotFoundError) {
      return jsonError(error.message, 404);
    }

    logger.error("project.detail.failed", {
      projectId,
      mode,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("프로젝트 상세 정보를 불러오지 못했습니다.", 500);
  }
}
