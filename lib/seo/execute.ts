import type { SeoTask } from "@prisma/client";
import {
  DataForSeoClient,
  DataForSeoError,
  type RunContext,
  type VendorEnvelope,
} from "@/lib/external/dataforseo";
import {
  checkpointTask,
  taskResult,
  savedCheckpoint,
  markTask,
  beginExecution,
  releaseClaim,
} from "./tasks";
import { onpageRequest, parseOnpage } from "./adapters/onpage";
import { serpRequest, parseSerp } from "./adapters/serp";
import { keywordsRequest, parseKeywords } from "./adapters/keywords";
import {
  object,
  number,
  collectionSchema,
  type FrozenInput,
} from "./adapters/types";
import { publicHost } from "./input";
function normalize(
  task: SeoTask,
  response: VendorEnvelope,
  input: FrozenInput,
) {
  if (task.operation.startsWith("onpage"))
    return parseOnpage(
      response,
      task.operation === "onpage_instant" ? input : undefined,
    );
  if (task.operation.startsWith("serp")) return parseSerp(response, input);
  return parseKeywords(response, task.operation, input);
}
export async function executeTask(
  task: SeoTask,
  client = new DataForSeoClient(),
) {
  let started = false;
  let checkpointFailed = false,
    receivedIdentity = !!task.vendorTaskId;
  try {
    const stored = await savedCheckpoint(task);
    if (stored) {
      await beginExecution(task);
      started = true;
      await taskResult(task, stored);
      return;
    }
    const input = task.frozenInput as unknown as FrozenInput;
    if (!task.vendorTaskId) await publicHost(input.host);
    const request = task.operation.startsWith("onpage")
      ? onpageRequest(task.operation, input)
      : task.operation.startsWith("serp")
        ? serpRequest(input)
        : keywordsRequest(task.operation, input);
    await beginExecution(task);
    started = true;
    const live = !request.path.endsWith("/task_post");
    const ctx: RunContext = {
      ownerId: task.ownerId,
      deadline: Date.now() + 45000,
      requestId: task.runKey,
      taskId: task.vendorTaskId ?? undefined,
      onTask: async (id, cost, response) => {
        receivedIdentity = !!id;
        try {
          const success =
            response?.status_code === 20000 &&
            !!response.tasks?.length &&
            response.tasks.every((t) => t.status_code === 20000);
          const result =
            live && response && (success || task.operation === "onpage_instant")
              ? normalize(task, response, input)
              : undefined;
          await checkpointTask(task, id, cost, result);
        } catch {
          checkpointFailed = true;
          throw new Error("checkpoint_failed");
        }
      },
    };
    let response: VendorEnvelope;
    let actualPages: number | null = null;
    let collection: import("./adapters/types").Checkpoint["collection"] = null;
    if (live) {
      // A Live ID without a durable result cannot be resubmitted or used as an asynchronous task ID.
      if (task.vendorTaskId) {
        await markTask(task, "uncertain", "result_reconciliation_required");
        return;
      }
      response = await client.post(request.path, request.body, ctx);
    } else if (task.operation === "onpage_crawl") {
      const summary = await client.task(request.path, request.body, ctx, {
        resultPath: (_base, id) => `on_page/summary/${encodeURIComponent(id)}`,
        isComplete: (r) =>
          object(r.tasks?.[0]?.result?.[0]).crawl_progress === "finished",
      });
      actualPages = number(
        object(object(summary.tasks?.[0]?.result?.[0]).crawl_status)
          .pages_crawled,
      );
      const rawSummary = object(summary.tasks?.[0]?.result?.[0]);
      const parsedCollection = collectionSchema.safeParse({
        extendedStatus:
          object(rawSummary.domain_info).extended_crawl_status ?? null,
        stopReason: rawSummary.crawl_stop_reason ?? null,
      });
      if (parsedCollection.success) collection = parsedCollection.data;
      const id = task.vendorTaskId ?? summary.tasks?.[0]?.id;
      if (!id) throw new DataForSeoError("submission_uncertain");
      // pages is a result read via POST; it never creates a new crawl.
      response = await client.post("on_page/pages", [{ id, limit: 20 }], {
        ownerId: task.ownerId,
        requestId: task.runKey,
        deadline: ctx.deadline,
      });
    } else response = await client.task(request.path, request.body, ctx);
    const result = normalize(task, response, input);
    if (actualPages !== null) result.crawledPages = actualPages;
    result.collection = collection;
    // Live response was already committed by onTask; task-based reads need a durable normalized checkpoint.
    if (!live)
      await checkpointTask(
        task,
        task.vendorTaskId ?? response.tasks?.[0]?.id ?? undefined,
        0,
        result,
      );
    await taskResult(task, result);
  } catch (error) {
    if (!started) {
      await releaseClaim(task);
      return;
    }
    if (checkpointFailed) {
      await markTask(task, "uncertain", "submission_uncertain");
      return;
    }
    if (error instanceof DataForSeoError) {
      // Batch rejection can still contain paid successful pages. Apply the durable partial result.
      const stored = await savedCheckpoint(task);
      if (stored?.pageFailures.length && stored.pages.length) {
        try {
          await taskResult(task, stored);
        } catch {
          await markTask(task, "submitted", "저장 결과 반영 대기 중입니다.");
        }
        return;
      }
      if (
        error.reason === "task_pending" ||
        (receivedIdentity &&
          [
            "vendor_unavailable",
            "vendor_rate_limited",
            "vendor_http_failed",
          ].includes(error.reason))
      ) {
        await markTask(task, "submitted", "결과 확인 대기 중입니다.");
        return;
      }
      if (
        [
          "submission_uncertain",
          "vendor_invalid_response",
          "vendor_http_failed",
        ].includes(error.reason)
      ) {
        await markTask(task, "uncertain", "submission_uncertain");
        return;
      }
      // A known rejected request is final. Preserve any confirmed charge from onTask.
      await markTask(task, "failed", "외부 수집에 실패했습니다.");
      return;
    }
    // Preserve a received result so a database failure can be retried without buying it again.
    const stored = await savedCheckpoint(task);
    await markTask(
      task,
      stored ? "submitted" : "uncertain",
      stored ? "저장 결과 반영 대기 중입니다." : "submission_uncertain",
    );
  }
}
