import { jsonError, jsonOk } from "@/lib/api-response";
import { logger } from "@/server/logger";
import { authorizeProjectRoute } from "@/server/services/project-route-auth-service";
import {
  ProjectContentNotFoundError,
  ProjectImageNotFoundError,
  ProjectNotFoundError,
  selectProjectContentAssetImage,
  updateProjectContentAssetDetail,
} from "@/server/services/project-service";

type RouteContext = {
  params: Promise<{
    projectId: string;
    contentJobId: string;
    assetId: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { projectId, contentJobId, assetId } = await context.params;
  const auth = await authorizeProjectRoute(request, projectId, "operator");

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = (await request.json().catch(() => null)) as
      | {
          imageAssetId?: string;
          title?: string;
          body?: string;
          cta?: string;
          hashtags?: string;
        }
      | null;

    if (body?.imageAssetId?.trim()) {
      const contentJob = await selectProjectContentAssetImage({
        projectId,
        contentJobId,
        assetId,
        imageAssetId: body.imageAssetId.trim(),
      });

      return jsonOk({ contentJob });
    }

    if (!body?.body?.trim()) {
      return jsonError("저장할 본문이 필요합니다.", 400);
    }

    const contentJob = await updateProjectContentAssetDetail({
      projectId,
      contentJobId,
      assetId,
      title: body.title?.trim(),
      body: body.body.trim(),
      cta: body.cta?.trim(),
      hashtags: body.hashtags?.trim(),
    });

    return jsonOk({ contentJob });
  } catch (error) {
    if (
      error instanceof ProjectNotFoundError ||
      error instanceof ProjectContentNotFoundError ||
      error instanceof ProjectImageNotFoundError
    ) {
      return jsonError(error.message, 404);
    }

    logger.error("projects.content_jobs.assets.update.failed", {
      projectId,
      contentJobId,
      assetId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("콘텐츠 자산 수정에 실패했습니다.", 500);
  }
}
