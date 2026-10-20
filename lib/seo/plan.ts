import { PLAN_LIMITS, type PlanKey } from "@/lib/billing/limits";
import type { Prisma } from "@prisma/client";
import { notFound, VisibilityError } from "@/lib/visibility/http";
import { estimate, supported } from "./budget";
import type { FrozenInput } from "./adapters/types";
import type { SeoEngine, AuditScope } from "@/types/seo";
import { normalizedKeyword } from "./keywords";
import type { Market } from "@/types/visibility";
export interface RunInput {
  domainId: string;
  runKey: string;
  mode?: "instant" | "crawl";
  paths?: string[];
  engines?: SeoEngine[];
  keywordIds?: string[];
  keywords?: string[];
}
export interface Config extends RunInput {
  host: string;
  market: Market;
  scope: AuditScope;
  engines: SeoEngine[];
  requestedPages: number | null;
  autoRankings: boolean;
  autoRankingsState?: "waiting" | "scheduled" | "skipped" | "expired";
}
export interface TaskPlan {
  operation: string;
  itemKey: string;
  frozenInput: FrozenInput;
  reservedKrw: number;
  status: string;
  failReason?: string;
}
/** TaskPlan → SeoTask.create 입력. frozenInput 직렬화 캐스팅만 담당. */
export function taskData(t: TaskPlan, ownerId: string, runKey: string) {
  return {
    ...t,
    ownerId,
    runKey,
    frozenInput: t.frozenInput as unknown as Prisma.InputJsonValue,
  };
}
export function taskPlan(
  operation: string,
  itemKey: string,
  input: FrozenInput,
  units = 1,
): TaskPlan {
  if (!supported(operation, input.market))
    return {
      operation,
      itemKey,
      frozenInput: input,
      reservedKrw: 0,
      status: "skipped",
      failReason: "지원이 확인되지 않은 작업입니다.",
    };
  return {
    operation,
    itemKey,
    frozenInput: input,
    reservedKrw: estimate(operation, units),
    status: "pending",
  };
}
export async function rankPlans(
  tx: Prisma.TransactionClient,
  ownerId: string,
  config: Config,
  plan: PlanKey,
  automatic = false,
): Promise<TaskPlan[]> {
  const selected = config.keywordIds?.length
    ? await tx.seoKeyword.findMany({
        where: {
          id: { in: config.keywordIds },
          domainId: config.domainId,
          market: config.market,
          domain: { ownerId },
        },
        select: { id: true, keyword: true },
      })
    : [];
  if (selected.length !== (config.keywordIds?.length ?? 0)) notFound();
  if (selected.length * config.engines.length > 10)
    throw new VisibilityError(
      "bad_request",
      "키워드·엔진 조합은 최대 10개입니다.",
      400,
    );
  const unique = [
    ...new Map(selected.map((k) => [normalizedKeyword(k.keyword), k])).values(),
  ];
  const tasks = unique.flatMap((k) =>
    config.engines.map((engine) =>
      taskPlan(`serp_${engine}`, `${k.id}:${engine}`, {
        host: config.host,
        market: config.market,
        engine,
        keyword: k.keyword,
      }),
    ),
  );
  if (!tasks.length) return tasks;
  const [count, existing] = await Promise.all([
    tx.seoKeyword.count({ where: { domainId: config.domainId } }),
    tx.seoKeyword.findMany({
      where: {
        domainId: config.domainId,
        market: config.market,
        engine: { in: config.engines },
        normalizedKeyword: {
          in: unique.map((k) => normalizedKeyword(k.keyword)),
        },
      },
      select: { id: true, engine: true, normalizedKeyword: true },
    }),
  ]);
  const known = new Set(
    existing.map((k) => `${k.engine}:${k.normalizedKeyword}`),
  );
  for (const task of tasks) {
    const existingRow = existing.find(
      (k) =>
        k.engine === task.frozenInput.engine &&
        k.normalizedKeyword === normalizedKeyword(task.frozenInput.keyword!),
    );
    if (existingRow) task.frozenInput.reservedKeywordId = existingRow.id;
  }
  let room = Math.max(0, PLAN_LIMITS[plan].seoKeywordsPerDomain - count);
  const missing = tasks.filter(
    (t) =>
      t.status === "pending" &&
      !known.has(
        `${t.frozenInput.engine}:${normalizedKeyword(t.frozenInput.keyword!)}`,
      ),
  );
  if (!automatic && missing.length > room)
    throw new VisibilityError(
      "rate_limited",
      "키워드 한도를 초과했습니다.",
      429,
    );
  for (const task of missing) {
    if (room <= 0) {
      task.status = "failed";
      task.reservedKrw = 0;
      task.failReason = "키워드 한도로 순위 수집을 보류했습니다.";
      continue;
    }
    const input = task.frozenInput;
    // Reserve the engine-specific keyword row before discovery can consume its capacity.
    const reserved = await tx.seoKeyword.create({
      data: {
        domainId: config.domainId,
        reservationOnly: true,
        market: config.market,
        engine: input.engine!,
        keyword: input.keyword!,
        normalizedKeyword: normalizedKeyword(input.keyword!),
      },
      select: { id: true },
    });
    task.frozenInput.reservedKeywordId = reserved.id;
    room--;
  }
  return tasks;
}
export async function buildPlans(
  tx: Prisma.TransactionClient,
  ownerId: string,
  config: Config,
  plan: PlanKey,
) {
  const input = { host: config.host, market: config.market };
  const tasks: TaskPlan[] = [];
  if (config.scope === "full" || config.scope === "technical") {
    if (config.mode === "crawl")
      tasks.push(taskPlan("onpage_crawl", "-", input, 20));
    else
      tasks.push(
        taskPlan(
          "onpage_instant",
          "-",
          { ...input, paths: config.paths ?? ["/"] },
          (config.paths ?? ["/"]).length,
        ),
      );
  }
  if (config.scope === "full" || config.scope === "research") {
    tasks.push(
      taskPlan("labs_ranked", "-", input, 100),
      taskPlan("keywords_for_site", "-", {
        ...input,
        keywords: config.keywords,
      }),
    );
    if (config.market === "ko-KR")
      tasks.push(
        taskPlan("naver_volume", "-", { ...input, keywords: config.keywords }),
      );
  }
  tasks.push(...(await rankPlans(tx, ownerId, config, plan)));
  return tasks;
}
