import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lockOwner } from "@/lib/visibility/queries";
import { notFound, VisibilityError } from "@/lib/visibility/http";
import { checkSeoFeature } from "@/lib/billing/limits";
import { MARKET_LOCATIONS } from "@/lib/market/constants";
import { taskPlan, taskData, type Config, type TaskPlan } from "./plan";
import { METRIC_OPERATIONS, metricUnits, NEW_METRIC_KEYWORD_CAP } from "./adapters/metric-contract";
import { checkSeoBudget } from "./budget";

/** Reserve once after discovery, serialized with all owner spending. No vendor I/O. */
export async function scheduleMetricTasks(ownerId: string, id: string) {
  await prisma.$transaction(async tx => {
    const plan = await lockOwner(tx, ownerId);
    const audit = await tx.seoAudit.findFirst({where: {id, domain: {ownerId}}});
    if (!audit) notFound();
    const config = audit.frozenConfig as unknown as Config;
    // Legacy audits do not silently acquire newly introduced paid operations.
    if (config.metricScheduling !== "waiting") return;
    if (await tx.seoTask.count({where: {auditId: id, operation: {in: ["labs_ranked", "keywords_for_site"]},
      status: {in: ["pending", "claimed", "submitted"]}}})) return;
    const candidates = await tx.seoKeyword.findMany({where: {domainId: audit.domainId, market: audit.market,
      engine: "google", reservationOnly: false, lastAuditId: id, domain: {ownerId}},
      select: {id: true, normalizedKeyword: true},
      orderBy: [{searchVolume: {sort: "desc", nulls: "last"}}, {id: "asc"}], take: NEW_METRIC_KEYWORD_CAP});
    const location = MARKET_LOCATIONS[config.market];
    const end = new Date(Date.UTC(audit.createdAt.getUTCFullYear(), audit.createdAt.getUTCMonth(), 0));
    const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11, 1));
    const tasks: TaskPlan[] = [];
    // Twelve frozen months × 10 keywords, worst-case UTF-8 keyword bytes, stays below 256 KiB.
    // Demand parser explicitly selects this period; it does not truncate returned arrays.
    for (let offset = 0; offset < candidates.length; offset += 10) {
      const batch = candidates.slice(offset, offset + 10), batchIndex = offset / 10;
      for (const operation of METRIC_OPERATIONS) {
        const input = {host: config.host, market: config.market, engine: "google" as const,
          keywordIds: batch.map(k => k.id), keywords: batch.map(k => k.normalizedKeyword),
          location: location.location_code, language: location.language_code, batchIndex, units: batch.length,
          targetPeriod: operation === "kw_demand" ? {fromYear: start.getUTCFullYear(), fromMonth: start.getUTCMonth()+1,
            toYear: end.getUTCFullYear(), toMonth: end.getUTCMonth()+1} : null};
        try { tasks.push(taskPlan(operation, `${input.location}:${batchIndex}`, input, metricUnits(operation, input))); }
        catch (e) {
          if (!(e instanceof VisibilityError)) throw e;
          tasks.push({operation, itemKey: `${input.location}:${batchIndex}`, frozenInput: input, status: "failed", reservedKrw: 0,
            failReason: "가격 검증에 실패하여 지표 수집을 보류했습니다."});
        }
      }
    }
    if (!candidates.length) for (const operation of METRIC_OPERATIONS) tasks.push({operation,
      itemKey: `${location.location_code}:0`, frozenInput: {host: config.host, market: config.market},
      status: "skipped", reservedKrw: 0, failReason: "수집할 Google 키워드가 없습니다."});
    try {
      checkSeoFeature(plan);
      await checkSeoBudget(tx, ownerId, plan, tasks.reduce((sum,t) => sum+t.reservedKrw,0));
    } catch (e) {
      if (!(e instanceof VisibilityError)) throw e;
      for (const task of tasks) if (task.status === "pending") Object.assign(task, {status: "failed", reservedKrw: 0,
        failReason: "예산 또는 실행 조건으로 지표 수집을 보류했습니다."});
    }
    await tx.seoTask.createMany({data: tasks.map(t => ({...taskData(t,ownerId,audit.runKey), auditId: id})), skipDuplicates: true});
    await tx.seoAudit.update({where: {id}, data: {frozenConfig: {...config, metricScheduling: "scheduled"} as unknown as Prisma.InputJsonValue}});
    await tx.auditLog.create({data: {actor: ownerId, action: "seo.metrics.reserve", targetType: "seo_audit", targetId: id,
      payload: {tasks: tasks.length, selected: candidates.length}}});
  });
}
