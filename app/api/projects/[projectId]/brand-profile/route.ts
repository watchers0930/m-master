import { jsonError, jsonOk } from "@/lib/api-response";
import { logger } from "@/server/logger";
import { approveProjectContext, ProjectNotFoundError } from "@/server/services/project-service";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { projectId } = await context.params;

  try {
    const body = (await request.json()) as {
      summary?: string;
      audience?: string;
      tone?: string;
      cta?: string;
      bannedTerms?: string;
    };

    if (!body.summary?.trim()) {
      return jsonError("서비스 요약은 필수입니다.", 400);
    }

    const project = await approveProjectContext({
      projectId,
      summary: body.summary.trim(),
      audience: body.audience?.trim(),
      tone: body.tone?.trim(),
      cta: body.cta?.trim(),
      bannedTerms: body.bannedTerms?.trim(),
    });

    return jsonOk({ project });
  } catch (error) {
    if (error instanceof ProjectNotFoundError) {
      return jsonError(error.message, 404);
    }

    logger.error("projects.brand_profile.approve.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("컨텍스트 승인 저장에 실패했습니다.", 500);
  }
}
