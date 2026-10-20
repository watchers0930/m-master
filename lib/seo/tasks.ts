import { Prisma, type SeoTask } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lockOwner } from "@/lib/visibility/queries";
import { checkSeoFeature } from "@/lib/billing/limits";
import { trackCost } from "@/lib/cost/tracker";
import { VisibilityError } from "@/lib/visibility/http";
import { checkSeoBudget, estimate, supported } from "./budget";
import {
  checkpointSchema,
  type Checkpoint,
  type FrozenInput,
} from "./adapters/types";
import { writeKeywords, normalizedKeyword } from "./keywords";
import { saveRankings } from "./rankings";
import { releaseKeywordReservations } from "./reservations";
export const LEASE_MS = 5 * 60000;
export async function claimTask(ownerId: string, id: string) {
  return (await claimTasks(ownerId, [id]))[0] ?? null;
}
/** All claims commit together; validation failure cannot strand an earlier claim. */
export async function claimTasks(ownerId: string, ids: string[]) {
  return prisma.$transaction(async (tx) => {
    const plan = await lockOwner(tx, ownerId);
    const claims: SeoTask[] = [];
    for (const id of ids) {
      const claim = await claimInTransaction(tx, ownerId, id, plan);
      if (claim) claims.push(claim);
    }
    return claims;
  });
}
async function claimInTransaction(
  tx: Prisma.TransactionClient,
  ownerId: string,
  id: string,
  plan: import("@/lib/billing/limits").PlanKey,
) {
  const task = await tx.seoTask.findFirst({
    where: { id, ownerId, audit: { domain: { ownerId } } },
  });
  if (
    !task ||
    ["completed", "partial", "skipped", "failed", "uncertain"].includes(
      task.status,
    ) ||
    (task.leaseUntil && task.leaseUntil.getTime() > Date.now())
  )
    return null;
  if (
    (await tx.seoTask.count({
      where: {
        ownerId,
        status: { in: ["claimed", "submitted"] },
        leaseUntil: { gt: new Date() },
      },
    })) >= 2
  )
    return null;
  if (!task.vendorTaskId && !task.resultCheckpoint) {
    checkSeoFeature(plan);
    const input = task.frozenInput as unknown as FrozenInput;
    if (!supported(task.operation, input.market))
      throw new VisibilityError(
        "bad_request",
        "이 시장에서 지원이 확인되지 않은 작업입니다.",
        400,
      );
    const units =
      task.operation === "onpage_crawl"
        ? 20
        : task.operation === "onpage_instant"
          ? (input.paths ?? ["/"]).length
          : task.operation === "labs_ranked"
            ? 100
            : 1;
    const reserve = estimate(task.operation, units);
    await checkSeoBudget(
      tx,
      ownerId,
      plan,
      Math.max(0, reserve - task.reservedKrw),
    );
    await tx.seoTask.update({
      where: { id },
      data: { reservedKrw: reserve },
    });
  }
  const changed = await tx.seoTask.updateMany({
    where: {
      id,
      ownerId,
      claimVersion: task.claimVersion,
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }],
    },
    data: {
      status: "claimed",
      claimVersion: { increment: 1 },
      leaseUntil: new Date(Date.now() + LEASE_MS),
    },
  });
  return changed.count
    ? { ...task, status: "claimed", claimVersion: task.claimVersion + 1 }
    : null;
}

/** Commit the submission boundary before any vendor I/O. Stale workers cannot POST. */
export async function beginExecution(task: SeoTask) {
  await prisma.$transaction(async (tx) => {
    await lockOwner(tx, task.ownerId);
    const changed = await tx.seoTask.updateMany({
      where: {
        id: task.id,
        ownerId: task.ownerId,
        claimVersion: task.claimVersion,
        status: "claimed",
        leaseUntil: { gt: new Date() },
      },
      data: { status: "submitted" },
    });
    if (!changed.count)
      throw new VisibilityError(
        "conflict",
        "작업 소유권이 변경되었습니다.",
        409,
      );
  });
}

/** Only never-submitted work may be returned without reconciliation. */
export async function releaseClaim(task: SeoTask) {
  await prisma.$transaction(async (tx) => {
    await lockOwner(tx, task.ownerId);
    await tx.seoTask.updateMany({
      where: {
        id: task.id,
        ownerId: task.ownerId,
        claimVersion: task.claimVersion,
        status: "claimed",
      },
      data: {
        status:
          task.vendorTaskId || task.resultCheckpoint ? "submitted" : "pending",
        leaseUntil: null,
        claimVersion: { increment: 1 },
        ...(!task.vendorTaskId && !task.resultCheckpoint
          ? { reservedKrw: 0 }
          : {}),
      },
    });
  });
}
async function current(tx: Prisma.TransactionClient, task: SeoTask) {
  const row = await tx.seoTask.findFirst({
    where: {
      id: task.id,
      ownerId: task.ownerId,
      claimVersion: task.claimVersion,
      status: "submitted",
      leaseUntil: { gt: new Date() },
    },
  });
  if (!row)
    throw new VisibilityError("conflict", "작업 소유권이 변경되었습니다.", 409);
  return row;
}
/** Identity, result checkpoint and ledger delta commit atomically under the owner lock. */
export async function checkpointTask(
  task: SeoTask,
  vendorTaskId: string | undefined,
  costKrw: number,
  result?: Checkpoint,
) {
  if (!Number.isFinite(costKrw) || costKrw < 0) throw new Error("invalid_cost");
  if (result && Buffer.byteLength(JSON.stringify(result)) > 256 * 1024)
    throw new Error("checkpoint_too_large");
  await prisma.$transaction(async (tx) => {
    await lockOwner(tx, task.ownerId);
    const row = await current(tx, task);
    const delta = Math.max(0, costKrw - row.costKrw);
    if (!row.ledgerRecordedAt || delta > 0)
      await trackCost(
        {
          ownerId: task.ownerId,
          kind: "seo",
          tokensIn: 0,
          tokensOut: 0,
          krw: delta,
        },
        { strict: true, db: tx },
      );
    await tx.seoTask.update({
      where: { id: task.id },
      data: {
        vendorTaskId: vendorTaskId ?? row.vendorTaskId,
        costKrw: Math.max(row.costKrw, costKrw),
        ledgerRecordedAt: row.ledgerRecordedAt ?? new Date(),
        reservedKrw: result ? 0 : Math.max(0, row.reservedKrw - delta),
        ...(result
          ? { resultCheckpoint: result as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });
  });
}
export async function taskResult(task: SeoTask, result: Checkpoint) {
  await prisma.$transaction(
    async (tx) => {
      const plan = await lockOwner(tx, task.ownerId);
      await current(tx, task);
      const audit = await tx.seoAudit.findUniqueOrThrow({
        where: { id: task.auditId },
        select: { domainId: true, market: true, runKey: true },
      });
      const ids = await writeKeywords(
        tx,
        audit.domainId,
        audit.market,
        result.metrics,
        result.observations,
        plan,
        task.auditId,
        task.operation === "keywords_for_site" ? "keywords_for_site" : null,
      );
      const rankings = result.observations.flatMap((row) => {
        const keywordId = ids.get(
          `${row.engine}:${normalizedKeyword(row.keyword)}`,
        );
        return keywordId ? [{ keywordId, row }] : [];
      });
      await saveRankings(
        tx,
        audit.domainId,
        task.auditId,
        audit.market,
        audit.runKey,
        rankings,
        new Date(result.observedAt),
      );
      await tx.seoTask.update({
        where: { id: task.id },
        data: {
          status: result.pageFailures.length
            ? result.pages.length
              ? "partial"
              : "failed"
            : "completed",
          leaseUntil: null,
          reservedKrw: 0,
          failReason: result.pageFailures.length
            ? "일부 URL 수집에 실패했습니다."
            : null,
          resultCheckpoint: result as unknown as Prisma.InputJsonValue,
        },
      });
    },
    { timeout: 20000 },
  );
}
export async function savedCheckpoint(task: SeoTask) {
  const row = await prisma.seoTask.findUniqueOrThrow({
    where: { id: task.id },
    select: { resultCheckpoint: true },
  });
  return row.resultCheckpoint
    ? checkpointSchema.parse(row.resultCheckpoint)
    : null;
}
export async function markTask(
  task: SeoTask,
  status: string,
  failReason: string,
) {
  await prisma.$transaction(async (tx) => {
    await lockOwner(tx, task.ownerId);
    await tx.seoTask.updateMany({
      where: {
        id: task.id,
        ownerId: task.ownerId,
        claimVersion: task.claimVersion,
      },
      data: {
        status,
        failReason,
        leaseUntil: null,
        ...(status === "failed" ? { reservedKrw: 0 } : {}),
      },
    });
    if (status === "failed" || status === "uncertain") {
      const audit = await tx.seoAudit.findUnique({
        where: { id: task.auditId },
        select: { domainId: true },
      });
      if (audit) await releaseKeywordReservations(tx, audit.domainId);
    }
  });
}
