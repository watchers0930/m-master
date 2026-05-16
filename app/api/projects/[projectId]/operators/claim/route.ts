import { jsonError, jsonOk } from "@/lib/api-response";
import { logger } from "@/server/logger";
import { claimUnownedProjectOperator, ProjectOperatorAuthError } from "@/server/services/project-operator-service";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;

  try {
    const body = (await request.json().catch(() => null)) as
      | {
          name?: string;
          accessKey?: string;
        }
      | null;

    const name = body?.name?.trim();
    const accessKey = body?.accessKey?.trim();

    if (!name || !accessKey) {
      return jsonError("운영자 이름과 접근 키가 필요합니다.", 400);
    }

    const operator = await claimUnownedProjectOperator({
      projectId,
      name,
      accessKey,
    });

    return jsonOk(
      {
        operator: {
          id: operator.id,
          name: operator.name,
          role: operator.role,
          active: operator.active,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ProjectOperatorAuthError) {
      return jsonError(error.message, error.status);
    }

    logger.error("project.operators.claim.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return jsonError("프로젝트 운영자 연결에 실패했습니다.", 500);
  }
}
