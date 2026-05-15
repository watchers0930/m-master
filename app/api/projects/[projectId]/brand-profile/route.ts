import { jsonError, jsonOk } from "@/lib/api-response";
import { logger } from "@/server/logger";
import { authorizeProjectRoute } from "@/server/services/project-route-auth-service";
import {
  approveProjectContext,
  ProjectNotFoundError,
  regenerateProjectContextDraft,
  saveProjectContextDraft,
} from "@/server/services/project-service";
import { parseBrandProfileInput } from "@/server/validators/brand-profile-validator";
import { ProjectValidationError } from "@/server/validators/project-validator";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const auth = await authorizeProjectRoute(_request, projectId, "operator");

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const project = await regenerateProjectContextDraft(projectId);
    return jsonOk({ project });
  } catch (error) {
    if (error instanceof ProjectNotFoundError) {
      return jsonError(error.message, 404);
    }

    logger.error("projects.brand_profile.regenerate.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("컨텍스트 재생성에 실패했습니다.", 500);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const auth = await authorizeProjectRoute(request, projectId, "reviewer");

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const input = await parseBrandProfileInput(request);
    const project = await approveProjectContext({
      projectId,
      summary: input.summary,
      audience: input.audience,
      tone: input.tone,
      cta: input.cta,
      bannedTerms: input.bannedTerms,
    });

    return jsonOk({ project });
  } catch (error) {
    if (error instanceof ProjectValidationError) {
      return jsonError(error.message, 400);
    }

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

export async function PUT(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const auth = await authorizeProjectRoute(request, projectId, "operator");

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const input = await parseBrandProfileInput(request);
    const project = await saveProjectContextDraft({
      projectId,
      summary: input.summary,
      audience: input.audience,
      tone: input.tone,
      cta: input.cta,
      bannedTerms: input.bannedTerms,
    });

    return jsonOk({ project });
  } catch (error) {
    if (error instanceof ProjectValidationError) {
      return jsonError(error.message, 400);
    }

    if (error instanceof ProjectNotFoundError) {
      return jsonError(error.message, 404);
    }

    logger.error("projects.brand_profile.draft.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("컨텍스트 임시 저장에 실패했습니다.", 500);
  }
}
