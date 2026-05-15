import { jsonError, jsonOk } from "@/lib/api-response";
import { logger } from "@/server/logger";
import {
  ProjectContextApprovalRequiredError,
  markProjectReadyForPublish,
  ProjectContentNotFoundError,
  ProjectNotFoundError,
  WordPressPublishError,
} from "@/server/services/project-service";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;

  try {
    const body = (await request.json().catch(() => null)) as
        | {
          wordpress?: {
            siteUrl?: string;
            username?: string;
            appPassword?: string;
            status?: "draft" | "publish";
            categoryNames?: string;
            tagNames?: string;
          };
          publishOverrides?: {
            title?: string;
            slug?: string;
            summary?: string;
            bodyHtml?: string;
          };
        }
      | null;

    const publish = await markProjectReadyForPublish(projectId, {
      wordpress: body?.wordpress?.siteUrl
        ? {
            siteUrl: body.wordpress.siteUrl,
            username: body.wordpress.username || "",
            appPassword: body.wordpress.appPassword || "",
            status: body.wordpress.status === "publish" ? "publish" : "draft",
            categoryNames: body.wordpress.categoryNames || "",
            tagNames: body.wordpress.tagNames || "",
          }
        : undefined,
      publishOverrides: body?.publishOverrides
        ? {
            title: body.publishOverrides.title || "",
            slug: body.publishOverrides.slug || "",
            summary: body.publishOverrides.summary || "",
            bodyHtml: body.publishOverrides.bodyHtml || "",
          }
        : undefined,
    });
    return jsonOk({ publish });
  } catch (error) {
    if (error instanceof ProjectNotFoundError || error instanceof ProjectContentNotFoundError) {
      return jsonError(error.message, 404);
    }

    if (error instanceof ProjectContextApprovalRequiredError) {
      return jsonError("컨텍스트 승인이 끝난 프로젝트만 발행 준비를 진행할 수 있습니다.", 409);
    }

    if (error instanceof WordPressPublishError) {
      return jsonError(error.message, 400);
    }

    logger.error("projects.publish.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("발행 준비 처리에 실패했습니다.", 500);
  }
}
