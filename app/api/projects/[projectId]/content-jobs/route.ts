import { jsonError, jsonOk } from "@/lib/api-response";
import { logger } from "@/server/logger";
import { generateProjectContent, ProjectNotFoundError } from "@/server/services/project-service";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;

  try {
    const body = (await request.json()) as {
      topic?: string;
      objective?: string;
    };

    if (!body.topic?.trim()) {
      return jsonError("주제는 필수입니다.", 400);
    }

    const studio = await generateProjectContent({
      projectId,
      topic: body.topic.trim(),
      objective: body.objective?.trim(),
    });

    return jsonOk({ studio }, { status: 201 });
  } catch (error) {
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
