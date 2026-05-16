import { jsonError, jsonOk } from "@/lib/api-response";
import { logger } from "@/server/logger";
import { authorizeProjectRoute } from "@/server/services/project-route-auth-service";
import {
  getProjectChannelPublicationHistory,
  ProjectNotFoundError,
  recordProjectAutomationBatchRun,
  retryProjectChannelPublication,
} from "@/server/services/project-service";
import { MetaPublishError } from "@/server/services/meta-publish-service";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get("limit") || "20");
  const auth = await authorizeProjectRoute(request, projectId, "analyst");

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const publications = await getProjectChannelPublicationHistory(projectId, limit);
    return jsonOk({ publications });
  } catch (error) {
    if (error instanceof ProjectNotFoundError) {
      return jsonError(error.message, 404);
    }

    logger.error("projects.publications.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("채널 게시 이력을 불러오지 못했습니다.", 500);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const auth = await authorizeProjectRoute(request, projectId, "operator");

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = (await request.json().catch(() => null)) as
      | {
          publicationId?: string;
          executionSource?: string;
          skipAuditLog?: boolean;
        }
      | null;

    if (!body?.publicationId) {
      return jsonError("재시도할 채널 게시 이력 ID가 필요합니다.", 400);
    }

    const publication = await retryProjectChannelPublication({
      projectId,
      publicationId: body.publicationId,
    });

    if (!body.skipAuditLog) {
      await recordProjectAutomationBatchRun({
        projectId,
        kind: "publication_retry_single",
        label: "채널 게시 단건 재시도",
        actorLabel: auth.operator.name,
        executionSource: body.executionSource || "studio",
        durationMs: null,
        completed: publication.status === "failed" ? 0 : 1,
        failed: publication.status === "failed" ? 1 : 0,
        items: [
          {
            id: publication.id,
            label: `${publication.channel} · ${publication.provider}`,
            status: publication.status === "failed" ? "failed" : "success",
            message: publication.status === "failed" ? publication.errorMessage || "채널 재시도 실패" : "채널 재시도 성공",
          },
        ],
      });
    }

    return jsonOk({ publication });
  } catch (error) {
    if (error instanceof ProjectNotFoundError) {
      return jsonError(error.message, 404);
    }

    if (error instanceof MetaPublishError) {
      return jsonError(error.message, 400);
    }

    logger.error("projects.publications.retry.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("채널 게시 재시도에 실패했습니다.", 500);
  }
}
