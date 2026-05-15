import { jsonError, jsonOk } from "@/lib/api-response";
import { logger } from "@/server/logger";
import { sendProjectOperationsAlert } from "@/server/services/project-alert-service";
import { authorizeProjectRoute } from "@/server/services/project-route-auth-service";
import {
  executeProjectAutomation,
  ProjectAutomationReadinessError,
  ProjectContentNotFoundError,
  ProjectNotFoundError,
  ProjectPlanItemNotFoundError,
  recordProjectAutomationBatchRun,
  resolveProjectAutomationReview,
} from "@/server/services/project-service";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const auth = await authorizeProjectRoute(request, projectId, "operator");

  if (!auth.ok) {
    return auth.response;
  }

  let executionSource = "studio";

  try {
    const body = (await request.json().catch(() => null)) as
      | {
          action?: "run" | "approve" | "retry";
          planItemId?: string;
          executionSource?: string;
          skipAuditLog?: boolean;
        }
      | null;
    executionSource = body?.executionSource || "studio";

    if (body?.action === "approve" || body?.action === "retry") {
      if (!body.planItemId) {
        return jsonError("검토 처리 대상 계획 항목 ID가 필요합니다.", 400);
      }

      const resolution = await resolveProjectAutomationReview({
        projectId,
        planItemId: body.planItemId,
        action: body.action,
      });

      if (!body.skipAuditLog) {
        await recordProjectAutomationBatchRun({
          projectId,
          kind: body.action === "approve" ? "review_approve" : "review_retry",
          label: body.action === "approve" ? "검토 항목 단건 승인" : "검토 항목 단건 재실행",
          actorLabel: auth.operator.name,
          executionSource: body.executionSource || "studio",
          durationMs: null,
          completed: resolution.status === "failed" ? 0 : 1,
          failed: resolution.status === "failed" ? 1 : 0,
          items: [
            {
              id: resolution.planItemId,
              label: resolution.planItemId,
              status: resolution.status === "failed" ? "failed" : "success",
              message: resolution.message,
            },
          ],
        });
      }

      return jsonOk({ resolution });
    }

    const startedAt = Date.now();
    const run = await executeProjectAutomation(projectId);

    await recordProjectAutomationBatchRun({
      projectId,
      kind: "automation_run",
      label: "프로젝트 자동 실행",
      actorLabel: auth.operator.name,
      executionSource: body?.executionSource || "studio",
      durationMs: Date.now() - startedAt,
      completed: run.published + run.readyToPublish,
      failed: run.failed + run.needsReview,
      items: run.results.map((item) => ({
        id: item.planItemId,
        label: item.planItemId,
        status: item.status === "failed" || item.status === "needs_review" ? "failed" : "success",
        message: item.message,
      })),
    });

    if (run.failed > 0 || run.needsReview > 0) {
      await sendProjectOperationsAlert({
        severity: run.failed > 0 ? "critical" : "warning",
        category: run.failed > 0 ? "failure" : "needs_review",
        title: "프로젝트 자동 실행 결과 경고",
        projectId,
        executionSource,
        lines: [
          `게시 ${run.published}건`,
          `발행 준비 ${run.readyToPublish}건`,
          `검토 필요 ${run.needsReview}건`,
          `실패 ${run.failed}건`,
        ],
      });
    }

    return jsonOk({ run });
  } catch (error) {
    if (error instanceof ProjectAutomationReadinessError) {
      await sendProjectOperationsAlert({
        severity: "warning",
        category: "blocked",
        title: "프로젝트 자동 실행 사전 차단",
        projectId,
        executionSource,
        lines: [error.message],
      });

      return jsonError(error.message, 409);
    }

    if (
      error instanceof ProjectNotFoundError ||
      error instanceof ProjectContentNotFoundError ||
      error instanceof ProjectPlanItemNotFoundError
    ) {
      return jsonError(error.message, 404);
    }

    logger.error("projects.automation.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    await sendProjectOperationsAlert({
      severity: "critical",
      category: "failure",
      title: "프로젝트 자동 실행 실패",
      projectId,
      executionSource,
      lines: [error instanceof Error ? error.message : "unknown_error"],
    });

    return jsonError("프로젝트 자동 실행에 실패했습니다.", 500);
  }
}
