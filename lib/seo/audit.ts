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
import { PAYMENT_REQUIRED_MESSAGE } from "./messages";
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
/**
 * 이번 요청에서 처리할 작업(최대 2개). collectOnly면 수거 작업만.
 * - 수거 작업(공급자에 이미 보냈거나 결과가 저장된 것, 무과금 — tasks.ts claimInTransaction의 예산 검사 제외 조건과 같다)과
 *   새로 보낼 작업을 따로 고른다. 수거 작업이 있으면 한 자리는 반드시 수거에 준다 — 예산에 거절되는 미전송 작업이
 *   두 자리를 차지해 이미 낸 돈의 결과 수거를 영원히 막지 않게(codex 2차 MED).
 * - 각 종류 안에서는 가장 오래 손대지 않은 작업부터(updatedAt). 생성 시각 순이면 결과를 기다리는 작업이 매번 다시 뽑혀
 *   안 보낸 작업이 차례를 못 받았다(2026-11-27 운영: 순위 10개 중 2개가 20분간 미전송). 집힐 때마다 updatedAt이 갱신돼 번갈아 돈다.
 */
export async function nextTasks(ownerId: string, id: string, collectOnly: boolean) {
  const base = {
    auditId: id,
    ownerId,
    status: { in: ["pending", "claimed", "submitted"] },
    OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }],
  };
  const order = [{ updatedAt: "asc" as const }, { createdAt: "asc" as const }, { id: "asc" as const }];
  const collect = (
    await prisma.seoTask.findMany({
      where: { ...base, AND: [{ OR: [{ vendorTaskId: { not: null } }, { resultCheckpoint: { not: Prisma.DbNull } }] }] },
      select: { id: true },
      orderBy: order,
      take: 2,
    })
  ).map((t) => ({ ...t, collect: true }));
  if (collectOnly) return collect;
  const submit = (
    await prisma.seoTask.findMany({
      where: { ...base, vendorTaskId: null, resultCheckpoint: { equals: Prisma.DbNull } },
      select: { id: true },
      orderBy: order,
      take: 2,
    })
  ).map((t) => ({ ...t, collect: false }));
  // 두 종류가 다 있으면 하나씩(2개 상한), 한 종류뿐이면 그 종류에서 2개
  return collect.length && submit.length ? [collect[0], submit[0]] : [...collect, ...submit];
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
  const candidates = await nextTasks(ownerId, id, options.collectOnly ?? false);
  // 이미 보낸 작업(결과 수거, 무과금)을 먼저 집는다. 새 제출이 예산·단가 검사에 걸려 claimTasks 트랜잭션이 통째로
  // 되돌려져도, 이미 낸 돈의 결과는 받고 나서 오류를 알린다(codex MED — 막힌 미전송 작업이 수거를 붙잡지 않게).
  const sent = candidates.filter((c) => c.collect), unsent = candidates.filter((c) => !c.collect);
  const claims = await claimTasks(ownerId, sent.map((c) => c.id));
  let refused: unknown = null;
  if (unsent.length)
    try {
      claims.push(...(await claimTasks(ownerId, unsent.map((c) => c.id))));
    } catch (error) {
      if (!claims.length) throw error;
      refused = error;
    }
  await Promise.all(claims.map((task) => executeTask(task)));
  if (refused) {
    await synthesize(ownerId, id);
    throw refused;
  }
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
        failReason: true,
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
          : tasks.some((t) => t.failReason === PAYMENT_REQUIRED_MESSAGE)
            ? PAYMENT_REQUIRED_MESSAGE
          : status === "partial" || status === "failed"
            ? "일부 수집이 실패했거나 실행 조건으로 완료되지 않았습니다."
            : null,
      },
    });
  });
}
