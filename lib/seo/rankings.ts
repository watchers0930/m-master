import type { Prisma } from "@prisma/client";
import type { Observation } from "./adapters/types";
export async function saveRankings(
  tx: Prisma.TransactionClient,
  domainId: string,
  auditId: string,
  market: string,
  runKey: string,
  rows: { keywordId: string; row: Observation }[],
  observedAt: Date,
) {
  // Keep first observation for the same immutable snapshot, as the former upsert did.
  const unique = new Map<string, { keywordId: string; row: Observation }>();
  for (const item of rows) {
    const key = `${item.keywordId}:${item.row.source}`;
    if (!unique.has(key)) unique.set(key, item);
  }
  if (!unique.size) return;
  await tx.seoRanking.createMany({
    data: [...unique.values()].map(({ keywordId, row }) => ({
      domainId,
      keywordId,
      auditId,
      market,
      runKey,
      engine: row.engine,
      source: row.source,
      rank: row.rank,
      rankAbsolute: row.rankAbsolute,
      matchedUrl: row.matchedUrl,
      status: row.status,
      returnedRange: row.returnedRange,
      device: "desktop",
      depth: row.engine === "google" ? 100 : null,
      requestedPages: 1,
      sourceObservedAt: row.sourceObservedAt
        ? new Date(row.sourceObservedAt)
        : null,
      capturedAt: observedAt,
    })),
    skipDuplicates: true,
  });
  // Read the persisted snapshot so replay cannot change the cached rank.
  await tx.$executeRaw`
    UPDATE seo_keywords k SET rank = r.rank, rank_status = r.status,
      rank_source = 'serp', rank_observed_at = r.captured_at,
      updated_at = ${new Date()}
    FROM seo_rankings r
    WHERE r.keyword_id = k.id AND r.audit_id = ${auditId}
      AND r.domain_id = ${domainId} AND k.domain_id = ${domainId}
      AND r.source = 'serp' AND r.device = 'desktop'
      AND r.status IN ('ranked', 'not_found_in_range')
      AND (k.rank_observed_at IS NULL OR k.rank_observed_at <= r.captured_at)`;
}
