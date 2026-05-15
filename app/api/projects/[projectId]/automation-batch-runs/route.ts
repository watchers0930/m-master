import { jsonError, jsonOk } from "@/lib/api-response";
import { logger } from "@/server/logger";
import {
  getProjectAutomationBatchRunHistory,
  ProjectNotFoundError,
  recordProjectAutomationBatchRun,
} from "@/server/services/project-service";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get("limit") || "10");

  try {
    const runs = await getProjectAutomationBatchRunHistory(projectId, limit);
    return jsonOk({ runs });
  } catch (error) {
    if (error instanceof ProjectNotFoundError) {
      return jsonError(error.message, 404);
    }

    logger.error("projects.automation_batch_runs.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("대량 처리 이력을 불러오지 못했습니다.", 500);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;

  try {
    const body = (await request.json().catch(() => null)) as
      | {
          kind?:
            | "plan_approve"
            | "plan_retry"
            | "publication_retry"
            | "automation_run"
            | "review_approve"
            | "review_retry"
            | "publication_retry_single";
          label?: string;
          actorLabel?: string;
          executionSource?: string;
          durationMs?: number;
          completed?: number;
          failed?: number;
          items?: Array<{
            id?: string;
            label?: string;
            status?: "success" | "failed";
            message?: string;
          }>;
        }
      | null;

    if (!body?.kind || !body.label || !Array.isArray(body.items)) {
      return jsonError("대량 처리 저장에 필요한 값이 누락되었습니다.", 400);
    }

    const normalizedItems = body.items.flatMap((item) => {
      if (
        !item ||
        typeof item.id !== "string" ||
        typeof item.label !== "string" ||
        typeof item.message !== "string" ||
        (item.status !== "success" && item.status !== "failed")
      ) {
        return [];
      }

      return [
        {
          id: item.id,
          label: item.label,
          status: item.status,
          message: item.message,
        },
      ];
    });

    const run = await recordProjectAutomationBatchRun({
      projectId,
      kind: body.kind,
      label: body.label,
      actorLabel: typeof body.actorLabel === "string" ? body.actorLabel : "operator",
      executionSource: typeof body.executionSource === "string" ? body.executionSource : "studio",
      durationMs: typeof body.durationMs === "number" ? body.durationMs : null,
      completed: typeof body.completed === "number" ? body.completed : 0,
      failed: typeof body.failed === "number" ? body.failed : 0,
      items: normalizedItems,
    });

    return jsonOk({ run });
  } catch (error) {
    if (error instanceof ProjectNotFoundError) {
      return jsonError(error.message, 404);
    }

    logger.error("projects.automation_batch_runs.create.failed", {
      projectId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return jsonError("대량 처리 이력 저장에 실패했습니다.", 500);
  }
}
