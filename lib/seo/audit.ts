import { scheduleMetricTasks } from "./metric-scheduling";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lockOwner } from "@/lib/visibility/queries";
import { notFound, VisibilityError } from "@/lib/visibility/http";
import {
  checkSeoFeature,
  checkSeoAuditLimit,
  PLAN_LIMITS,
} from "@/lib/billing/limits";
import { marketSchema } from "@/lib/market/schema";
import type { AuditScope } from "@/types/seo";
import { publicHost } from "./input";
import { filterHash } from "./pagination";
import { checkSeoBudget } from "./budget";
import {
  buildPlans,
  taskData,
  type Config,
  type RunInput,
} from "./plan";
import { scheduleAutomaticRankings } from "./automatic-rankings";
import { claimTasks } from "./tasks";
import { executeTask } from "./execute";
import {
  expireAbandonedAudit,
  releaseKeywordReservations,
} from "./reservations";
import { recoverExpired } from "./pending";
import { getAudit, ownedDomain } from "./data";
import { technicalChecks } from "./checks";
import { technicalScore } from "./score";
import { checkpointSchema } from "./adapters/types";
export async function runAudit(
  ownerId: string,
  input: RunInput,
  scope: AuditScope,
) {
  const domain = await ownedDomain(ownerId, input.domainId);
  const market = marketSchema.parse(domain.market);
  const engines = [
    ...(input.engines ??
      (market === "ko-KR"
        ? (["google", "naver"] as const)
        : (["google"] as const))),
  ].sort();
  if (engines.includes("naver") && market !== "ko-KR")
    throw new VisibilityError(
      "bad_request",
      "네이버는 한국 시장에서만 지원합니다.",
      400,
    );
  // Hash request semantics before discovery; later frozen candidate selection does not change idempotency.
  const canonical = {
    ...input,
    mode:
      scope === "full" || scope === "technical"
        ? (input.mode ?? "instant")
        : undefined,
    paths: input.paths ? [...new Set(input.paths)].sort() : undefined,
    engines,
    keywordIds: input.keywordIds ? [...input.keywordIds].sort() : undefined,
    keywords: input.keywords ? [...input.keywords].sort() : undefined,
    scope,
    host: domain.url,
    market,
  };
  const configHash = filterHash(canonical);
  const existing = await prisma.seoAudit.findUnique({
    where: { domainId_runKey: { domainId: domain.id, runKey: input.runKey } },
    select: { id: true, configHash: true },
  });
  if (existing) {
    if (existing.configHash !== configHash) conflict();
    return { data: await getAudit(ownerId, existing.id), reused: true };
  }
  const host = await publicHost(domain.url);
  const result = await prisma.$transaction(async (tx) => {
    const plan = await lockOwner(tx, ownerId);
    const found = await tx.domain.findFirst({
      where: { id: domain.id, ownerId },
      select: { id: true },
    });
    if (!found) notFound();
    const reused = await tx.seoAudit.findUnique({
      where: { domainId_runKey: { domainId: domain.id, runKey: input.runKey } },
      select: { id: true, configHash: true },
    });
    if (reused) {
      if (reused.configHash !== configHash) conflict();
      return { id: reused.id, reused: true };
    }
    await expireAbandonedAudit(tx, ownerId, domain.id);
    await releaseKeywordReservations(tx, domain.id);
    checkSeoFeature(plan);
    await checkSeoAuditLimit(ownerId, plan, tx);
    if (
      await tx.seoAudit.count({
        where: { domainId: domain.id, status: "pending" },
      })
    )
      conflict();
    if (
      await tx.auditLog.count({
        where: {
          actor: ownerId,
          action: "seo.audit.reserve",
          targetId: domain.id,
          createdAt: { gt: new Date(Date.now() - 60000) },
        },
      })
    )
      throw new VisibilityError(
        "rate_limited",
        "새 진단은 60초 후 실행하세요.",
        429,
      );
    if (
      (await tx.seoKeyword.count({ where: { domainId: domain.id } })) >
      PLAN_LIMITS[plan].seoKeywordsPerDomain
    )
      throw new VisibilityError(
        "rate_limited",
        "키워드 한도를 초과했습니다.",
        429,
      );
    const config: Config = {
      ...canonical,
      host,
      scope,
      engines,
      requestedPages:
        scope === "full" || scope === "technical"
          ? input.mode === "crawl"
            ? 20
            : (input.paths ?? ["/"]).length
          : null,
      metricScheduling: scope === "full" || scope === "research" ? "waiting" : undefined,
      autoRankings: scope === "full" && !input.keywordIds,
      autoRankingsState:
        scope === "full" && !input.keywordIds ? "waiting" : undefined,
    };
    const tasks = await buildPlans(tx, ownerId, config, plan);
    await checkSeoBudget(
      tx,
      ownerId,
      plan,
      tasks.reduce((n, t) => n + t.reservedKrw, 0),
    );
    const row = await tx.seoAudit.create({
      data: {
        domainId: domain.id,
        market,
        scope,
        mode: config.mode ?? null,
        runKey: input.runKey,
        configHash,
        frozenConfig: config as unknown as Prisma.InputJsonValue,
        tasks: { create: tasks.map((t) => taskData(t, ownerId, input.runKey)) },
      },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        actor: ownerId,
        action: "seo.audit.reserve",
        targetType: "domain",
        targetId: domain.id,
        payload: { auditId: row.id },
      },
    });
    return { id: row.id, reused: false };
  });
  if (!result.reused) await processAudit(ownerId, result.id);
  return { data: await getAudit(ownerId, result.id), reused: result.reused };
}
function conflict(): never {
  throw new VisibilityError(
    "conflict",
    "동일 키의 입력이 다르거나 진행 중인 진단이 있습니다.",
    409,
  );
}
export async function resumeAudit(ownerId: string, id: string) {
  await getAudit(ownerId, id);
  await processAudit(ownerId, id);
  return getAudit(ownerId, id);
}
export async function processAudit(
  ownerId: string,
  id: string,
  options: { collectOnly?: boolean } = {},
) {
  await prisma.$transaction(async (tx) => {
    await lockOwner(tx, ownerId);
    await recoverExpired(tx, ownerId, id);
    const audit = await tx.seoAudit.findFirst({
      where: { id, domain: { ownerId } },
      select: { domainId: true, frozenConfig: true },
    });
    if (audit) {
      await expireAbandonedAudit(tx, ownerId, audit.domainId, id);
      await releaseKeywordReservations(tx, audit.domainId);
    }
  });
  // At most two tasks per request, at most two concurrent external collectors.
  // Processing result-only tasks also consumes a slot, keeping I/O bounded.
  // collectOnly restricts work to already-submitted tasks (vendorTaskId present):
  // task_get reconciliation never bills, and no never-submitted task is posted.
  const candidates = await prisma.seoTask.findMany({
    where: {
      auditId: id,
      ownerId,
      status: { in: ["pending", "claimed", "submitted"] },
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }],
      ...(options.collectOnly ? { AND: [{ OR: [
        { vendorTaskId: { not: null } }, { resultCheckpoint: { not: Prisma.DbNull } },
      ] }] } : {}),
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: 2,
  });
  const claims = await claimTasks(
    ownerId,
    candidates.map((candidate) => candidate.id),
  );
  await Promise.all(claims.map((task) => executeTask(task)));
  // collectOnly never executes a new paid POST; it may finish reservation scheduling (budget holds).
  if (options.collectOnly) {
    await scheduleMetricTasks(ownerId, id);
    await synthesize(ownerId, id);
    return;
  }
  // New candidates are only reserved here; they are submitted by an explicit subsequent resume.
  try {
    await scheduleMetricTasks(ownerId, id);
    await scheduleAutomaticRankings(ownerId, id);
  } catch (error) {
    await synthesize(ownerId, id);
    throw error;
  }
  await synthesize(ownerId, id);
}
async function synthesize(ownerId: string, id: string) {
  await prisma.$transaction(async (tx) => {
    await lockOwner(tx, ownerId);
    const audit = await tx.seoAudit.findFirst({
      where: { id, domain: { ownerId } },
      select: { frozenConfig: true, completedAt: true },
    });
    if (!audit) notFound();
    const tasks = await tx.seoTask.findMany({
      where: { auditId: id, ownerId },
      select: {
        status: true,
        costKrw: true,
        resultCheckpoint: true,
        operation: true,
      },
    });
    const config = audit.frozenConfig as unknown as Config;
    const pending =
      config.autoRankings || config.metricScheduling === "waiting" ||
      tasks.some((t) => ["pending", "claimed", "submitted"].includes(t.status));
    const success = tasks.filter((t) =>
      ["completed", "partial"].includes(t.status),
    ).length;
    // Preserve incomplete automatic collection, including legacy skipped policy markers.
    const automaticIncomplete =
      config.autoRankingsState === "skipped" ||
      config.autoRankingsState === "expired" || config.metricScheduling === "expired";
    const status = pending
      ? "pending"
      : !automaticIncomplete &&
          tasks.every((t) => ["completed", "skipped"].includes(t.status))
        ? "completed"
        : success
          ? "partial"
          : "failed";
    const technical = tasks
      .filter((t) => t.operation.startsWith("onpage") && t.resultCheckpoint)
      .map((t) => checkpointSchema.parse(t.resultCheckpoint));
    const pages = technical.flatMap((t) => t.pages);
    const { checks, coefficients } = technicalChecks(
      pages,
      technical.find((t) => t.collection)?.collection,
    );
    const score = technicalScore(checks, coefficients);
    await tx.seoAudit.update({
      where: { id },
      data: {
        status,
        frozenConfig: {
          ...config,
          crawledPages: technical.length
            ? technical.reduce((n, t) => n + (t.crawledPages ?? 0), 0)
            : null,
        } as unknown as Prisma.InputJsonValue,
        costKrw: tasks.reduce((n, t) => n + t.costKrw, 0),
        ...(config.scope === "full" || config.scope === "technical"
          ? { ...score, checks: checks as unknown as Prisma.InputJsonValue }
          : {}),
        completedAt: pending ? null : (audit.completedAt ?? new Date()),
        failReason: tasks.some((t) => t.status === "uncertain")
          ? "과금 대조 및 복구가 필요한 작업이 있습니다."
          : status === "partial" || status === "failed"
            ? "일부 수집이 실패했거나 실행 조건으로 완료되지 않았습니다."
            : null,
      },
    });
  });
}
