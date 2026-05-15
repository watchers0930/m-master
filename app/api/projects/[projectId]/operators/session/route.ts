import { jsonError, jsonOk } from "@/lib/api-response";
import { logger } from "@/server/logger";
import {
  authenticateProjectOperator,
  buildProjectOperatorSessionClearCookie,
  buildProjectOperatorSessionCookie,
  getAuthorizedProjectOperator,
  ProjectOperatorAuthError,
  revokeProjectOperatorSession,
} from "@/server/services/project-operator-service";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { projectId } = await context.params;

  try {
    const operator = await getAuthorizedProjectOperator(request, projectId);
    return jsonOk({
      operator,
    });
  } catch (error) {
    logger.error("project.operator_session.get.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return jsonError("운영자 세션을 확인하지 못했습니다.", 500);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;

  try {
    const body = (await request.json().catch(() => null)) as
      | {
          name?: string;
          accessKey?: string;
        }
      | null;

    if (!body?.name?.trim() || !body?.accessKey?.trim()) {
      return jsonError("운영자 이름과 접근 키가 필요합니다.", 400);
    }

    const session = await authenticateProjectOperator({
      projectId,
      name: body.name.trim(),
      accessKey: body.accessKey.trim(),
    });

    const response = jsonOk({
      operator: session.operator,
      expiresAt: session.expiresAt.toISOString(),
    });
    response.headers.append("Set-Cookie", buildProjectOperatorSessionCookie(session.token));
    return response;
  } catch (error) {
    if (error instanceof ProjectOperatorAuthError) {
      return jsonError(error.message, error.status);
    }

    logger.error("project.operator_session.create.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return jsonError("운영자 로그인에 실패했습니다.", 500);
  }
}

export async function DELETE(request: Request) {
  try {
    await revokeProjectOperatorSession(request);
    const response = jsonOk({ revoked: true });
    response.headers.append("Set-Cookie", buildProjectOperatorSessionClearCookie());
    return response;
  } catch (error) {
    logger.error("project.operator_session.delete.failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return jsonError("운영자 로그아웃에 실패했습니다.", 500);
  }
}

