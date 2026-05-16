import { jsonError, jsonOk } from "@/lib/api-response";
import { logger } from "@/server/logger";
import {
  ProjectOperatorAuthError,
  recoverProjectOperatorAccess,
} from "@/server/services/project-operator-service";

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
          bootstrapSecret?: string;
        }
      | null;

    const name = body?.name?.trim();
    const accessKey = body?.accessKey?.trim();
    const bootstrapSecret = body?.bootstrapSecret?.trim();

    if (!name || !accessKey || !bootstrapSecret) {
      return jsonError("운영자 이름, 접근 키, 부트스트랩 키가 필요합니다.", 400);
    }

    const operator = await recoverProjectOperatorAccess({
      projectId,
      name,
      accessKey,
      bootstrapSecret,
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

    logger.error("project.operators.recover.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("운영자 복구에 실패했습니다.", 500);
  }
}
