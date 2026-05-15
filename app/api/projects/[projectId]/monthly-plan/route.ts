import { jsonError, jsonOk } from "../../../../../lib/api-response";
import { logger } from "../../../../../server/logger";
import {
  generateMonthlyProjectPlan,
  getProjectById,
  ProjectNotFoundError,
  runMonthlyProjectPlan,
} from "../../../../../server/services/project-service";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;

  try {
    const project = await getProjectById(projectId);
    return jsonOk({
      plan: project.latestContentPlan || null,
    });
  } catch (error) {
    if (error instanceof ProjectNotFoundError) {
      return jsonError(error.message, 404);
    }

    logger.error("project.monthly_plan.get.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return jsonError("월간 계획을 불러오지 못했습니다.", 500);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;

  try {
    const body = await request.json().catch(() => ({})) as { autoGenerate?: boolean };
    const plan = await generateMonthlyProjectPlan(projectId, Boolean(body.autoGenerate));
    return jsonOk({ plan });
  } catch (error) {
    if (error instanceof ProjectNotFoundError) {
      return jsonError(error.message, 404);
    }

    logger.error("project.monthly_plan.generate.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return jsonError(error instanceof Error ? error.message : "월간 계획 생성에 실패했습니다.", 500);
  }
}

export async function PATCH(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;

  try {
    const result = await runMonthlyProjectPlan(projectId);
    return jsonOk({ result });
  } catch (error) {
    if (error instanceof ProjectNotFoundError) {
      return jsonError(error.message, 404);
    }

    logger.error("project.monthly_plan.run.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return jsonError(error instanceof Error ? error.message : "월간 계획 실행에 실패했습니다.", 500);
  }
}
