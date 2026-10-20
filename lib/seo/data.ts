import { prisma } from "@/lib/prisma";
import { notFound } from "@/lib/visibility/http";
import type { z } from "zod";
import type {
  auditListSchema,
  keywordListSchema,
  rankingListSchema,
} from "@/schemas/seo";
import type { SeoAuditDTO, SeoKeywordDTO, SeoRankingDTO } from "@/types/seo";
import { after, decodeCursor, encodeCursor } from "./pagination";
import { isOpportunity } from "./keywords";
import { object, checkpointSchema } from "./adapters/types";
import { publicFailReason } from "./messages";
const auditSelect = {
  id: true,
  domainId: true,
  market: true,
  scope: true,
  mode: true,
  status: true,
  technicalScore: true,
  scoreVersion: true,
  coverage: true,
  checks: true,
  costKrw: true,
  createdAt: true,
  completedAt: true,
  failReason: true,
  frozenConfig: true,
  tasks: {
    select: {
      operation: true,
      status: true,
      itemKey: true,
      failReason: true,
      resultCheckpoint: true,
    },
  },
} as const;
type AuditRow = import("@prisma/client").Prisma.SeoAuditGetPayload<{
  select: typeof auditSelect;
}>;
export function auditDto(row: AuditRow): SeoAuditDTO {
  const { frozenConfig, tasks, ...rest } = row;
  const config = object(frozenConfig);
  return {
    ...rest,
    failReason: publicFailReason(row.failReason, row.status),
    market: row.market as SeoAuditDTO["market"],
    scope: row.scope as SeoAuditDTO["scope"],
    mode: row.mode as SeoAuditDTO["mode"],
    status: row.status as SeoAuditDTO["status"],
    checks: row.checks as unknown as SeoAuditDTO["checks"],
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    requestedPages:
      typeof config.requestedPages === "number" ? config.requestedPages : null,
    crawledPages:
      typeof config.crawledPages === "number" ? config.crawledPages : null,
    tasks: tasks.map(({ resultCheckpoint, ...t }) => ({
      ...t,
      failedUrls:
        checkpointSchema
          .safeParse(resultCheckpoint)
          .data?.pageFailures.map((failure) => failure.url) ?? [],
      failReason: publicFailReason(t.failReason, t.status),
      status: t.status as SeoAuditDTO["tasks"][number]["status"],
    })),
  };
}
export async function ownedDomain(ownerId: string, id: string) {
  const row = await prisma.domain.findFirst({
    where: { id, ownerId },
    select: { id: true, url: true, market: true },
  });
  if (!row) notFound();
  return row;
}
export async function getAudit(ownerId: string, id: string, domainId?: string) {
  const row = await prisma.seoAudit.findFirst({
    where: { id, domainId, domain: { ownerId } },
    select: auditSelect,
  });
  if (!row) notFound();
  return auditDto(row);
}
export async function listAudits(
  ownerId: string,
  input: z.infer<typeof auditListSchema>,
) {
  await ownedDomain(ownerId, input.domainId);
  if (input.auditId) return getAudit(ownerId, input.auditId, input.domainId);
  const { cursor, limit, ...filter } = input,
    bound = { ownerId, ...filter };
  const rows = await prisma.seoAudit.findMany({
    where: {
      domainId: input.domainId,
      domain: { ownerId },
      ...after(decodeCursor(cursor, bound), "createdAt"),
    },
    select: auditSelect,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: limit + 1,
  });
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items: items.map(auditDto),
    nextCursor:
      rows.length > limit && last
        ? encodeCursor(last.createdAt, last.id, bound)
        : null,
  };
}
export async function listKeywords(
  ownerId: string,
  input: z.infer<typeof keywordListSchema>,
) {
  await ownedDomain(ownerId, input.domainId);
  const { cursor, limit, search, ...filter } = input,
    bound = { ownerId, ...filter, search };
  const rows = await prisma.seoKeyword.findMany({
    where: {
      ...filter,
      domain: { ownerId },
      ...(search
        ? { keyword: { contains: search, mode: "insensitive" as const } }
        : {}),
      ...after(decodeCursor(cursor, bound), "createdAt"),
    },
    select: {
      id: true,
      keyword: true,
      market: true,
      engine: true,
      searchVolume: true,
      volumeScale: true,
      volumePeriod: true,
      competition: true,
      competitionRaw: true,
      rank: true,
      rankStatus: true,
      rankObservedAt: true,
      metricsUpdatedAt: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: limit + 1,
  });
  const items = rows.slice(0, limit),
    last = items.at(-1);
  return {
    items: items.map(
      ({ createdAt: _createdAt, ...r }): SeoKeywordDTO => ({
        ...r,
        market: r.market as SeoKeywordDTO["market"],
        engine: r.engine as SeoKeywordDTO["engine"],
        rankStatus: r.rankStatus as SeoKeywordDTO["rankStatus"],
        rankObservedAt: r.rankObservedAt?.toISOString() ?? null,
        metricsUpdatedAt: r.metricsUpdatedAt?.toISOString() ?? null,
        isOpportunity: isOpportunity(r),
      }),
    ),
    nextCursor:
      rows.length > limit && last
        ? encodeCursor(last.createdAt, last.id, bound)
        : null,
  };
}
export async function listRankings(
  ownerId: string,
  input: z.infer<typeof rankingListSchema>,
) {
  await ownedDomain(ownerId, input.domainId);
  if (
    input.keywordId &&
    !(await prisma.seoKeyword.findFirst({
      where: {
        id: input.keywordId,
        domainId: input.domainId,
        domain: { ownerId },
      },
      select: { id: true },
    }))
  )
    notFound();
  const { cursor, limit, domainId, from, to, ...filter } = input;
  // Include full timestamps so a cursor cannot be reused with a different intra-day range.
  const bound = {
    ownerId,
    domainId,
    ...filter,
    from: from.toISOString(),
    to: to.toISOString(),
  };
  const rows = await prisma.seoRanking.findMany({
    where: {
      ...filter,
      domainId,
      keyword: { domainId, domain: { ownerId } },
      audit: { domainId, domain: { ownerId } },
      capturedAt: { gte: from, lte: to },
      ...after(decodeCursor(cursor, bound), "capturedAt"),
    },
    select: {
      id: true,
      keywordId: true,
      keyword: { select: { keyword: true } },
      market: true,
      engine: true,
      device: true,
      rank: true,
      rankAbsolute: true,
      matchedUrl: true,
      status: true,
      source: true,
      sourceObservedAt: true,
      returnedRange: true,
      capturedAt: true,
    },
    orderBy: [{ capturedAt: "desc" }, { id: "asc" }],
    take: limit + 1,
  });
  const items = rows.slice(0, limit),
    last = items.at(-1);
  return {
    items: items.map(
      (r): SeoRankingDTO => ({
        ...r,
        keyword: r.keyword.keyword,
        market: r.market as SeoRankingDTO["market"],
        engine: r.engine as SeoRankingDTO["engine"],
        status: r.status as SeoRankingDTO["status"],
        source: r.source as SeoRankingDTO["source"],
        sourceObservedAt: r.sourceObservedAt?.toISOString() ?? null,
        capturedAt: r.capturedAt.toISOString(),
      }),
    ),
    nextCursor:
      rows.length > limit && last
        ? encodeCursor(last.capturedAt, last.id, bound)
        : null,
  };
}
