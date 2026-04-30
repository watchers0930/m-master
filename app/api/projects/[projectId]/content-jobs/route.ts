import { jsonError, jsonOk } from "@/lib/api-response";
import { logger } from "@/server/logger";
import { generateProjectContent, ProjectNotFoundError, saveProjectContentDraft } from "@/server/services/project-service";
import { parseContentJobInput } from "@/server/validators/content-job-validator";
import { ProjectValidationError } from "@/server/validators/project-validator";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;

  try {
    const input = await parseContentJobInput(request);

    const studio = await generateProjectContent({
      projectId,
      topic: input.topic,
      topicId: input.topicId,
      objective: input.objective,
    });

    return jsonOk({ studio }, { status: 201 });
  } catch (error) {
    if (error instanceof ProjectValidationError) {
      return jsonError(error.message, 400);
    }

    if (error instanceof ProjectNotFoundError) {
      return jsonError(error.message, 404);
    }

    logger.error("projects.content_jobs.create.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("콘텐츠 초안 생성에 실패했습니다.", 500);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { projectId } = await context.params;

  try {
    const input = await parseContentJobInput(request);

    if (!input.assets || input.assets.length === 0) {
      return jsonError("저장할 콘텐츠 자산이 필요합니다.", 400);
    }

    if (!input.topic) {
      return jsonError("주제는 필수입니다.", 400);
    }

    const studio = await saveProjectContentDraft({
      projectId,
      topic: input.topic,
      objective: input.objective,
      assets: input.assets,
    });

    return jsonOk({ studio });
  } catch (error) {
    if (error instanceof ProjectValidationError) {
      return jsonError(error.message, 400);
    }

    if (error instanceof ProjectNotFoundError) {
      return jsonError(error.message, 404);
    }

    logger.error("projects.content_jobs.save.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("콘텐츠 초안 저장에 실패했습니다.", 500);
  }
}
