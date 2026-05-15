import { jsonError, jsonOk } from "@/lib/api-response";
import { logger } from "@/server/logger";
import { authorizeProjectRoute } from "@/server/services/project-route-auth-service";
import {
  generateProjectImages,
  ProjectContextApprovalRequiredError,
  ProjectImageNotFoundError,
  ProjectNotFoundError,
  selectProjectImage,
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
    const body = (await request.json()) as {
      channel?: "blog" | "instagram" | "facebook";
      prompt?: string;
    };

    if (body.channel !== "blog" && body.channel !== "instagram" && body.channel !== "facebook") {
      return jsonError("이미지 생성 채널이 올바르지 않습니다.", 400);
    }

    const studio = await generateProjectImages({
      projectId,
      channel: body.channel,
      prompt: body.prompt?.trim(),
    });

    return jsonOk({ studio }, { status: 201 });
  } catch (error) {
    if (error instanceof ProjectNotFoundError || error instanceof ProjectImageNotFoundError) {
      return jsonError(error.message, 404);
    }

    if (error instanceof ProjectContextApprovalRequiredError) {
      return jsonError("컨텍스트 승인이 끝난 프로젝트만 이미지를 생성할 수 있습니다.", 409);
    }

    logger.error("projects.images.generate.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("이미지 생성에 실패했습니다.", 500);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const auth = await authorizeProjectRoute(request, projectId, "operator");

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = (await request.json()) as {
      channel?: "blog" | "instagram" | "facebook";
      imageAssetId?: string;
    };

    if (body.channel !== "blog" && body.channel !== "instagram" && body.channel !== "facebook") {
      return jsonError("이미지 선택 채널이 올바르지 않습니다.", 400);
    }

    if (!body.imageAssetId?.trim()) {
      return jsonError("선택할 이미지 자산 ID가 필요합니다.", 400);
    }

    const studio = await selectProjectImage({
      projectId,
      channel: body.channel,
      imageAssetId: body.imageAssetId.trim(),
    });

    return jsonOk({ studio });
  } catch (error) {
    if (error instanceof ProjectNotFoundError || error instanceof ProjectImageNotFoundError) {
      return jsonError(error.message, 404);
    }

    if (error instanceof ProjectContextApprovalRequiredError) {
      return jsonError("컨텍스트 승인이 끝난 프로젝트만 이미지를 선택할 수 있습니다.", 409);
    }

    logger.error("projects.images.select.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("이미지 선택 저장에 실패했습니다.", 500);
  }
}
