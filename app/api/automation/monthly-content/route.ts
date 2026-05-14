import { jsonError, jsonOk } from "../../../../lib/api-response";
import { logger } from "../../../../server/logger";
import { runAutomaticMonthlyPlans } from "../../../../server/services/project-service";

function isAuthorized(request: Request) {
  const secret = process.env.AUTOMATION_SECRET || process.env.CRON_SECRET;
  if (!secret) {
    return false;
  }

  const authorization = request.headers.get("authorization");
  if (authorization === `Bearer ${secret}`) {
    return true;
  }

  return request.headers.get("x-automation-secret") === secret;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return jsonError("자동 실행 권한이 없습니다.", 401);
  }

  try {
    const result = await runAutomaticMonthlyPlans();
    return jsonOk({ result });
  } catch (error) {
    logger.error("automation.monthly_content.failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return jsonError("월간 콘텐츠 자동 실행에 실패했습니다.", 500);
  }
}
