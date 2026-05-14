import { jsonError, jsonOk } from "@/lib/api-response";
import { logger } from "@/server/logger";
import { sendOperationsAlert } from "@/server/services/operations-alert-service";
import { sendProjectOperationsAlert } from "@/server/services/project-alert-service";
import { executeDueContentPlanItems, recordProjectAutomationBatchRun } from "@/server/services/project-service";

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();

  if (!secret) {
    return true;
  }

  const authHeader = request.headers.get("authorization") || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const headerToken = request.headers.get("x-cron-secret")?.trim() || "";

  return bearerToken === secret || headerToken === secret;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return jsonError("자동 실행 권한이 없습니다.", 401);
  }

  try {
    const startedAt = Date.now();
    const result = await executeDueContentPlanItems();
    const resultsByProject = new Map<string, typeof result.results>();

    for (const item of result.results) {
      const current = resultsByProject.get(item.projectId) ?? [];
      current.push(item);
      resultsByProject.set(item.projectId, current);
    }

    await Promise.all(
      Array.from(resultsByProject.entries()).map(([projectId, items]) =>
        recordProjectAutomationBatchRun({
          projectId,
          kind: "automation_run",
          label: "cron 자동 실행",
          actorLabel: "system",
          executionSource: "cron",
          durationMs: Date.now() - startedAt,
          completed: items.filter((item) => item.status === "published" || item.status === "ready_to_publish").length,
          failed: items.filter((item) => item.status === "failed" || item.status === "needs_review").length,
          items: items.map((item) => ({
            id: item.planItemId,
            label: item.planItemId,
            status: item.status === "failed" || item.status === "needs_review" ? "failed" : "success",
            message: item.message,
          })),
        }),
      ),
    );

    await Promise.all(
      Array.from(resultsByProject.entries()).map(async ([projectId, items]) => {
        const failed = items.filter((item) => item.status === "failed").length;
        const needsReview = items.filter((item) => item.status === "needs_review").length;

        if (failed === 0 && needsReview === 0) {
          return;
        }

        await sendProjectOperationsAlert({
          severity: failed > 0 ? "critical" : "warning",
          category: failed > 0 ? "failure" : "needs_review",
          title: "cron 자동 실행 결과 경고",
          projectId,
          executionSource: "cron",
          lines: [
            `검토 필요 ${needsReview}건`,
            `실패 ${failed}건`,
            ...items.slice(0, 4).map((item) => `${item.planItemId}: ${item.message}`),
          ],
        });
      }),
    );

    return jsonOk({ run: result });
  } catch (error) {
    logger.error("automation.run.failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });

    await sendOperationsAlert({
      severity: "critical",
      title: "cron 자동 실행 실패",
      executionSource: "cron",
      lines: [error instanceof Error ? error.message : "unknown_error"],
    });

    return jsonError("자동 실행 처리에 실패했습니다.", 500);
  }
}
