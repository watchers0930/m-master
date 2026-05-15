import { jsonError, jsonOk } from "../../../../../lib/api-response";
import { logger } from "../../../../../server/logger";
import { authorizeProjectRoute } from "../../../../../server/services/project-route-auth-service";
import {
  generateProjectMonthlyPlan,
  getProjectMonthlyPlan,
  ProjectContextApprovalRequiredError,
  ProjectNotFoundError,
} from "../../../../../server/services/project-service";
import {
  parseContentPlanInput,
  parseContentPlanQuery,
} from "../../../../../server/validators/content-plan-validator";
import { ProjectValidationError } from "../../../../../server/validators/project-validator";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { projectId } = await context.params;

  try {
    const { monthKey } = parseContentPlanQuery(request);
    const plan = await getProjectMonthlyPlan(projectId, monthKey);
    return jsonOk({ plan });
  } catch (error) {
    if (error instanceof ProjectValidationError) {
      return jsonError(error.message, 400);
    }

    if (error instanceof ProjectNotFoundError) {
      return jsonError(error.message, 404);
    }

    logger.error("project.content_plan.get.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("월간 계획을 불러오지 못했습니다.", 500);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const auth = await authorizeProjectRoute(request, projectId, "operator");

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const { monthKey } = await parseContentPlanInput(request);
    const plan = await generateProjectMonthlyPlan(projectId, monthKey);
    return jsonOk({ plan });
  } catch (error) {
    if (error instanceof ProjectValidationError) {
      return jsonError(error.message, 400);
    }

    if (error instanceof ProjectContextApprovalRequiredError) {
      return jsonError(error.message, 409);
    }

    if (error instanceof ProjectNotFoundError) {
      return jsonError(error.message, 404);
    }

    logger.error("project.content_plan.generate.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("월간 계획을 생성하지 못했습니다.", 500);
  }
}
