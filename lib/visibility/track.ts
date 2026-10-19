import { ENGINE_IDS } from "@/lib/market/constants";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getEngine } from "./engines";
import { normalizeVendor } from "./engines/parse";
import { detect } from "./detect";
import { lockOwner, requireVisibility } from "./queries";
import { checkCaptureBudget, type OwnerConfig } from "./budget";
import { VisibilityError, notFound } from "./http";
import { runKey } from "./run-key";
import { DataForSeoError } from "@/lib/external/dataforseo";
import { trackCost } from "@/lib/cost/tracker";
import { logAudit } from "@/lib/audit/logger";
import type {
  EngineId,
  EngineResult,
  Frequency,
  Market,
  SnapshotStatus,
} from "@/types/visibility";

import { CAPTURE_LEASE_MS, expireUnrecoverablePending } from "./pending";
const MIN_INTERVAL_MS = 60000;
const checkpointSchema = z.object({
  answerText: z.string(),
  citations: z.array(
    z.object({
      url: z.string(),
      title: z.string().optional(),
      position: z.number(),
    }),
  ),
  source: z.string(),
  status: z.enum(["ok", "no_result"]),
});
export interface CaptureResult {
  engine: EngineId;
  status: SnapshotStatus;
  snapshotId?: string;
  failReason?: string;
}
interface CaptureOptions {
  immediate?: boolean;
  ownerConfig?: OwnerConfig;
}
export async function capture(
  ownerId: string,
  queryId: string,
  requested?: EngineId[],
  options: CaptureOptions = {},
): Promise<CaptureResult[]> {
  const query = await prisma.visibilityQuery.findFirst({
    where: { id: queryId, ownerId },
    include: { domain: { select: { url: true } } },
  });
  if (!query) notFound();
  if (!query.active)
    throw new VisibilityError("bad_request", "비활성 질문입니다.", 400);
  const engines = requested ?? (query.engines as EngineId[]);
  if (
    !engines.length ||
    engines.some(
      (e) =>
        !query.engines.includes(e) ||
        !getEngine(e)?.supportsMarket(query.market as Market),
    )
  )
    throw new VisibilityError(
      "bad_request",
      "등록된 지원 엔진만 수집할 수 있습니다.",
      400,
    );
  // One short transaction reserves the entire run. No network calls while locks are held.
  const claims = await prisma.$transaction(
    async (tx) => {
      const plan = await lockOwner(tx, ownerId);
      requireVisibility(plan);
      const current = await tx.visibilityQuery.findFirst({
        where: { id: queryId, ownerId, active: true },
        include: { domain: { select: { url: true } } },
      });
      if (!current) notFound();
      if (engines.some((e) => !current.engines.includes(e) || !getEngine(e)?.supportsMarket(current.market as Market)))
        throw new VisibilityError(
          "bad_request",
          "질문이 변경되었습니다. 다시 시도하세요.",
          400,
        );
      const settings = options.ownerConfig
        ? null
        : await tx.setting.findUnique({
            where: { ownerId },
            select: { budgetMonthly: true },
          });
      const config: OwnerConfig = options.ownerConfig ?? {
        plan,
        budgetMonthly: settings?.budgetMonthly ?? 500000,
        queryCount: await tx.visibilityQuery.count({ where: { ownerId } }),
      };
      config.plan = plan;
      if (options.immediate) {
        const recent = await tx.visibilitySnapshot.findFirst({
          where: {
            queryId,
            query: { ownerId },
            capturedAt: { gt: new Date(Date.now() - MIN_INTERVAL_MS) },
          },
          select: { id: true },
        });
        if (recent)
          throw new VisibilityError(
            "rate_limited",
            "잠시 후 다시 수집하세요.",
            429,
          );
      }
      await expireUnrecoverablePending(tx, ownerId);
      const rows = [];
      const freshEngines: EngineId[] = [];
      for (const engine of [...new Set([...engines, ...ENGINE_IDS])]) {
        // A pending task is always resumed, even across weekly bucket boundaries.
        const pending = await tx.visibilitySnapshot.findFirst({
          where: { queryId, engine, status: "pending", query: { ownerId } },
          orderBy: { capturedAt: "asc" },
        });
        if (pending) {
          if (pending.capturedAt.getTime() > Date.now() - CAPTURE_LEASE_MS) {
            if (options.immediate)
              throw new VisibilityError(
                "rate_limited",
                "수집이 진행 중입니다.",
                429,
              );
            continue;
          }
          // Corrupt/missing checkpoint with no task identity is also terminal.
          if (
            !pending.taskId &&
            !checkpointSchema.safeParse(pending.rawJson).success
          ) {
            await tx.visibilitySnapshot.updateMany({
              where: { id: pending.id, query: { ownerId }, status: "pending" },
              data: { status: "failed", failReason: "submission_unrecoverable" },
            });
            continue;
          }
          const claimed = await tx.visibilitySnapshot.updateMany({
            where: {
              id: pending.id,
              query: { ownerId },
              capturedAt: pending.capturedAt,
              status: "pending",
            },
            data: { capturedAt: new Date() },
          });
          if (claimed.count) rows.push(pending);
          continue;
        }
        if (engines.includes(engine)) freshEngines.push(engine);
      }
      // Recover paid work before reserving new submissions. A blocked new budget must
      // never roll back an existing task's recovery claim.
      const recovering = rows.length > 0;
      for (const engine of freshEngines) {
        const key = options.immediate
          ? `immediate:${crypto.randomUUID()}`
          : runKey(queryId, engine, current.frequency as Frequency);
        const existing = await tx.visibilitySnapshot.findUnique({
          where: { queryId_engine_runKey: { queryId, engine, runKey: key } },
        });
        if (existing) continue;
        try {
          await checkCaptureBudget(tx, ownerId, config);
        } catch (error) {
          if (recovering && error instanceof VisibilityError && error.code === "rate_limited") continue;
          throw error;
        }
        rows.push(
          await tx.visibilitySnapshot.create({
            data: {
              captureConfig: {
                query: current.query, market: current.market,
                brandAliases: current.brandAliases, competitorAliases: current.competitorAliases,
                domain: current.domain?.url ?? null, domainId: current.domainId ?? null,
              },
              queryId,
              engine,
              runKey: key,
              status: "pending",
              failReason: "capture_in_progress",
            },
          }),
        );
      }
      return rows;
    },
    { timeout: 15000 },
  );
  const results: CaptureResult[] = [];
  // Bounded to two engines; each engine failure is isolated.
  for (let offset = 0; offset < claims.length; offset += 2) {
    results.push(
      ...(await Promise.all(
        claims.slice(offset, offset + 2).map(async (claim) => {
          const engine = claim.engine as EngineId;
          const configSchema = z.object({
            query: z.string(), market: z.string(), brandAliases: z.array(z.string()),
            competitorAliases: z.array(z.string()), domain: z.string().nullable(),
          });
          // Legacy rows predate frozen input; PATCH invalidates them under the same owner lock.
          const config = configSchema.parse(claim.captureConfig ?? {
            query: query.query, market: query.market, brandAliases: query.brandAliases,
            competitorAliases: query.competitorAliases, domain: query.domain?.url ?? null,
          });
          let vendorCompleted = false;
          try {
            const saved = checkpointSchema.safeParse(claim.rawJson);
            let result: EngineResult;
            if (saved.success) {
              result = {
                ...saved.data,
                engine,
                raw: saved.data,
                costKrw: claim.costKrw,
                taskId: claim.taskId ?? undefined,
              };
            } else {
              result = await getEngine(engine).capture(
                config.query,
                config.market as Market,
                {
                  ownerId,
                  queryId,
                  requestId: claim.id,
                  taskId: claim.taskId ?? undefined,
                  onTask: async (taskId, costKrw, response) => {
                    const complete =
                      response?.tasks?.[0]?.status_code === 20000 &&
                      response.tasks[0].result?.length;
                    let normalized: EngineResult | undefined;
                    try {
                      normalized = complete
                        ? normalizeVendor(
                            engine,
                            getEngine(engine).source,
                            response!,
                          )
                        : undefined;
                    } catch {
                      /* Preserve task identity and the incurred cost even for malformed vendor data. */
                    }
                    const rawJson = normalized
                      ? ({
                          answerText: normalized.answerText,
                          citations: normalized.citations,
                          source: normalized.source,
                          status: normalized.status,
                          vendor: normalized.raw,
                        } as unknown as Prisma.InputJsonValue)
                      : undefined;
                    await prisma.$transaction(async (tx) => {
                      // Exactly one ledger entry and billing checkpoint for the submission.
                      await tx.visibilitySnapshot.updateMany({
                        where: { id: claim.id, query: { ownerId } },
                        data: { taskId, costKrw, rawJson },
                      });
                      if (costKrw > 0)
                        await trackCost(
                          {
                            ownerId,
                            kind: "visibility",
                            tokensIn: 0,
                            tokensOut: 0,
                            krw: costKrw,
                          },
                          { strict: true, db: tx },
                        );
                    });
                  },
                },
              );
              vendorCompleted = true;
              // Durable normalized vendor result before optional LLM judgment.
              await prisma.visibilitySnapshot.update({
                where: { id: claim.id, query: { ownerId } },
                data: {
                  rawJson: {
                    answerText: result.answerText,
                    citations: result.citations,
                    source: result.source,
                    status: result.status,
                    vendor: result.raw,
                  } as unknown as Prisma.InputJsonValue,
                  source: result.source,
                },
              });
            }
            vendorCompleted = true;
            const detected =
              result.status === "ok"
                ? await detect({
                    ownerId,
                    answerText: result.answerText,
                    citations: result.citations,
                    domain: config.domain,
                    beforeJudge: async () => {
                      await prisma.$transaction(async (tx) => {
                        const plan = await lockOwner(tx, ownerId);
                        requireVisibility(plan);
                        if (
                          !(await tx.visibilityQuery.findFirst({
                            where: { id: queryId, ownerId },
                            select: { id: true },
                          }))
                        )
                          notFound();
                        const setting = await tx.setting.findUnique({
                          where: { ownerId },
                          select: { budgetMonthly: true },
                        });
                        await checkCaptureBudget(
                          tx,
                          ownerId,
                          {
                            plan,
                            budgetMonthly: setting?.budgetMonthly ?? 500000,
                            queryCount: await tx.visibilityQuery.count({
                              where: { ownerId },
                            }),
                          },
                          0,
                        );
                      });
                    },
                    brandAliases: config.brandAliases,
                    competitorAliases: config.competitorAliases,
                  })
                : { mentions: [], failReason: undefined };
            await prisma.$transaction(async (tx) => {
              await lockOwner(tx, ownerId);
              await tx.visibilitySnapshot.update({
                where: { id: claim.id, query: { ownerId }, status: "pending" },
                data: {
                  status: result.status,
                  source: result.source,
                  taskId: result.taskId,
                  answerText: result.answerText,
                  citations:
                    result.citations as unknown as Prisma.InputJsonValue,
                  failReason: detected.failReason ?? null,
                  capturedAt: new Date(),
                  mentions: { create: detected.mentions },
                },
              });
            });
            return {
              engine,
              status: result.status,
              snapshotId: claim.id,
              ...(detected.failReason
                ? { failReason: detected.failReason }
                : {}),
            };
          } catch (error) {
            const reason =
              error instanceof DataForSeoError
                ? error.reason
                : "capture_persistence_failed";
            const pending =
              vendorCompleted ||
              [
                "task_pending",
                "submission_uncertain",
                "vendor_unavailable",
              ].includes(reason) ||
              !(error instanceof DataForSeoError);
            const status = pending ? "pending" : "failed";
            await prisma.visibilitySnapshot
              .updateMany({
                where: { id: claim.id, query: { ownerId }, status: "pending" },
                data: { status, failReason: reason },
              })
              .catch(() => {
                console.error("[visibility] checkpoint update failed", {
                  snapshotId: claim.id,
                });
              });
            return {
              engine,
              status: status as SnapshotStatus,
              snapshotId: claim.id,
              failReason: reason,
            };
          }
        }),
      )),
    );
  }
  await logAudit({
    actor: ownerId,
    action: "visibility.capture",
    targetType: "visibility_query",
    targetId: queryId,
    payload: {
      results: results.map((r) => ({
        engine: r.engine,
        status: r.status,
        snapshotId: r.snapshotId ?? null,
      })),
    },
  });
  return results;
}
