import { jsonError, jsonOk } from "@/lib/api-response";
import { logger } from "@/server/logger";
import {
  getProjectContentJobDetail,
  ProjectContentNotFoundError,
  ProjectNotFoundError,
} from "@/server/services/project-service";

type RouteContext = {
  params: Promise<{
    projectId: string;
    contentJobId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { projectId, contentJobId } = await context.params;

  try {
    const contentJob = await getProjectContentJobDetail({
      projectId,
      contentJobId,
    });

    return jsonOk({ contentJob });
  } catch (error) {
    if (error instanceof ProjectNotFoundError || error instanceof ProjectContentNotFoundError) {
      return jsonError(error.message, 404);
    }

    logger.error("projects.content_jobs.detail.failed", {
      projectId,
      contentJobId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("콘텐츠 상세를 불러오지 못했습니다.", 500);
  }
}
