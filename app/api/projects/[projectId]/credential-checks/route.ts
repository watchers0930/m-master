import { jsonError, jsonOk } from "@/lib/api-response";
import { logger } from "@/server/logger";
import { getProjectCredentialHealth, runProjectCredentialCheck } from "@/server/services/credential-check-service";
import { authorizeProjectRoute } from "@/server/services/project-route-auth-service";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

type CredentialServiceKey = "blogger" | "meta" | "ga4" | "alerts";

function normalizeService(value: unknown): CredentialServiceKey | null {
  if (value === "blogger" || value === "meta" || value === "ga4" || value === "alerts") {
    return value;
  }

  return null;
}

export async function GET(request: Request, context: RouteContext) {
  const { projectId } = await context.params;

  try {
    const auth = await authorizeProjectRoute(request, projectId, "analyst");
    if (!auth.ok) {
      return auth.response;
    }

    const health = await getProjectCredentialHealth(projectId);
    return jsonOk({ health });
  } catch (error) {
    logger.error("project.credential_checks.get.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return jsonError("자격증명 점검 이력을 불러오지 못했습니다.", 500);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const auth = await authorizeProjectRoute(request, projectId, "operator");

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = (await request.json().catch(() => null)) as { service?: CredentialServiceKey } | null;
    const service = normalizeService(body?.service);

    if (!service) {
      return jsonError("점검 대상 서비스 값이 올바르지 않습니다.", 400);
    }

    const run = await runProjectCredentialCheck({
      projectId,
      service,
      actorLabel: auth.operator.name,
    });

    return jsonOk({ run });
  } catch (error) {
    logger.error("project.credential_checks.post.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return jsonError(error instanceof Error ? error.message : "자격증명 점검 실행에 실패했습니다.", 500);
  }
}
