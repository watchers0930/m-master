import { jsonError, jsonOk } from "@/lib/api-response";
import { logger } from "@/server/logger";
import { countProjectOperators } from "@/server/repositories/project-repository";
import { authorizeProjectRoute } from "@/server/services/project-route-auth-service";
import {
  bootstrapProjectOperator,
  createManagedProjectOperator,
  listProjectOperatorsForProject,
  ProjectOperatorAuthError,
  updateManagedProjectOperator,
} from "@/server/services/project-operator-service";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

type ProjectOperatorRole = "viewer" | "analyst" | "reviewer" | "operator" | "owner";

function normalizeRole(value: unknown): ProjectOperatorRole {
  if (value === "viewer" || value === "analyst" || value === "reviewer" || value === "operator" || value === "owner") {
    return value;
  }

  return "viewer";
}

export async function GET(request: Request, context: RouteContext) {
  const { projectId } = await context.params;

  try {
    const existingCount = await countProjectOperators(projectId);
    if (existingCount > 0) {
      const auth = await authorizeProjectRoute(request, projectId, "owner");
      if (!auth.ok) {
        return jsonOk({
          operators: [],
          bootstrapRequired: false,
        });
      }
    }

    const operators = await listProjectOperatorsForProject(projectId);
    return jsonOk({
      operators,
      bootstrapRequired: existingCount === 0,
    });
  } catch (error) {
    logger.error("project.operators.get.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return jsonError("운영자 목록을 불러오지 못했습니다.", 500);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;

  try {
    const body = (await request.json().catch(() => null)) as
      | {
          name?: string;
          role?: ProjectOperatorRole;
          accessKey?: string;
          bootstrapSecret?: string;
        }
      | null;

    const name = body?.name?.trim();
    const accessKey = body?.accessKey?.trim();
    const role = normalizeRole(body?.role);

    if (!name || !accessKey) {
      return jsonError("운영자 이름과 접근 키가 필요합니다.", 400);
    }

    const existingCount = await countProjectOperators(projectId);

    if (existingCount === 0) {
      const operator = await bootstrapProjectOperator({
        projectId,
        name,
        role: role === "viewer" ? "owner" : role,
        accessKey,
        bootstrapSecret: body?.bootstrapSecret?.trim() || "",
      });

      return jsonOk({
        operator: {
          id: operator.id,
          name: operator.name,
          role: operator.role,
          active: operator.active,
        },
      }, { status: 201 });
    }

    const auth = await authorizeProjectRoute(request, projectId, "owner");
    if (!auth.ok) {
      return auth.response;
    }

    const operator = await createManagedProjectOperator({
      projectId,
      name,
      role,
      accessKey,
    });

    return jsonOk({
      operator: {
        id: operator.id,
        name: operator.name,
        role: operator.role,
        active: operator.active,
      },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof ProjectOperatorAuthError) {
      return jsonError(error.message, error.status);
    }

    logger.error("project.operators.create.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return jsonError("운영자 계정을 저장하지 못했습니다.", 500);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const auth = await authorizeProjectRoute(request, projectId, "owner");

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = (await request.json().catch(() => null)) as
      | {
          operatorId?: string;
          role?: ProjectOperatorRole;
          active?: boolean;
          accessKey?: string;
        }
      | null;

    if (!body?.operatorId?.trim()) {
      return jsonError("수정할 운영자 ID가 필요합니다.", 400);
    }

    const operator = await updateManagedProjectOperator({
      projectId,
      operatorId: body.operatorId.trim(),
      role: body.role ? normalizeRole(body.role) : undefined,
      active: typeof body.active === "boolean" ? body.active : undefined,
      accessKey: body.accessKey?.trim() || undefined,
    });

    return jsonOk({
      operator: {
        id: operator.id,
        name: operator.name,
        role: operator.role,
        active: operator.active,
      },
    });
  } catch (error) {
    if (error instanceof ProjectOperatorAuthError) {
      return jsonError(error.message, error.status);
    }

    logger.error("project.operators.update.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return jsonError("운영자 계정을 수정하지 못했습니다.", 500);
  }
}
