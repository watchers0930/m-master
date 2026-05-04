import { jsonError, jsonOk } from "../../../../lib/api-response";
import { logger } from "../../../../server/logger";
import {
  deleteProject,
  getProjectById,
  getProjectStudioSeed,
  ProjectNotFoundError,
  saveProjectSettings,
} from "../../../../server/services/project-service";
import { parseUpdateProjectSettingsInput, ProjectValidationError } from "../../../../server/validators/project-validator";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode");

  try {
    if (mode === "studio") {
      const studio = await getProjectStudioSeed(projectId);
      return jsonOk({ studio });
    }

    const project = await getProjectById(projectId);
    return jsonOk({ project });
  } catch (error) {
    if (error instanceof ProjectNotFoundError) {
      return jsonError(error.message, 404);
    }

    logger.error("project.detail.failed", {
      projectId,
      mode,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("프로젝트 상세 정보를 불러오지 못했습니다.", 500);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;

  try {
    const deleted = await deleteProject(projectId);
    return jsonOk({ deleted });
  } catch (error) {
    if (error instanceof ProjectNotFoundError) {
      return jsonError(error.message, 404);
    }

    logger.error("project.delete.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("프로젝트를 삭제하지 못했습니다.", 500);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { projectId } = await context.params;

  try {
    const input = await parseUpdateProjectSettingsInput(request);
    const project = await saveProjectSettings({
      projectId,
      ...input,
    });
    return jsonOk({ project });
  } catch (error) {
    if (error instanceof ProjectValidationError) {
      return jsonError(error.message, 400);
    }

    if (error instanceof ProjectNotFoundError) {
      return jsonError(error.message, 404);
    }

    logger.error("project.update.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("프로젝트 설정을 저장하지 못했습니다.", 500);
  }
}
