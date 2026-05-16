import { jsonError, jsonOk } from "@/lib/api-response";
import { logger } from "@/server/logger";
import { authorizeProjectRoute } from "@/server/services/project-route-auth-service";
import {
  BloggerPublishError,
  ProjectContextApprovalRequiredError,
  markProjectReadyForPublish,
  ProjectContentNotFoundError,
  ProjectNotFoundError,
  ProjectPublishSafetyError,
} from "@/server/services/project-service";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const auth = await authorizeProjectRoute(request, projectId, "operator");

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = (await request.json().catch(() => null)) as
        | {
          blogger?: {
            blogId?: string;
            accessToken?: string;
            status?: "draft" | "publish";
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
      blogger: body?.blogger?.blogId
        ? {
            blogId: body.blogger.blogId,
            accessToken: body.blogger.accessToken || "",
            status: body.blogger.status === "publish" ? "publish" : "draft",
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

    if (error instanceof BloggerPublishError) {
      return jsonError(error.message, 400);
    }

    if (error instanceof ProjectPublishSafetyError) {
      return jsonError(error.message, 409);
    }

    logger.error("projects.publish.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("발행 준비 처리에 실패했습니다.", 500);
  }
}
