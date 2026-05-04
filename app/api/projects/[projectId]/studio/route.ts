import { jsonError, jsonOk } from "../../../../../lib/api-response";
import { logger } from "../../../../../server/logger";
import { getProjectStudioSeed, ProjectNotFoundError } from "../../../../../server/services/project-service";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;

  try {
    const studio = await getProjectStudioSeed(projectId);
    return jsonOk({ studio });
  } catch (error) {
    if (error instanceof ProjectNotFoundError) {
      return jsonError("프로젝트 또는 컨텍스트 초안을 찾을 수 없습니다.", 404);
    }

    logger.error("projects.studio.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("콘텐츠 스튜디오 초기 데이터를 불러오지 못했습니다.", 500);
  }
}
