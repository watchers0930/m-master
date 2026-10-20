import type { Prisma } from "@prisma/client";
import { PLAN_LIMITS, type PlanKey } from "@/lib/billing/limits";
import type { Metric } from "./adapters/types";
export const normalizedKeyword = (v: string) =>
  v.normalize("NFKC").trim().toLowerCase();
export function isOpportunity(row: {
  searchVolume: number | null;
  rank: number | null;
  rankStatus: string | null;
}) {
  return (
    row.searchVolume !== null &&
    row.searchVolume > 0 &&
    (row.rankStatus === "not_found_in_range" ||
      (row.rankStatus === "ranked" &&
        row.rank !== null &&
        row.rank >= 11 &&
        row.rank <= 30))
  );
}
/** Fixed number of DB round trips for a whole checkpoint. Owner lock required. */
export async function writeKeywords(
  tx: Prisma.TransactionClient,
  domainId: string,
  market: string,
  metrics: Metric[],
  observations: Pick<Metric, "keyword" | "engine">[],
  plan: PlanKey,
  auditId: string,
  volumeSource: string | null,
) {
  const keyOf = (m: Pick<Metric, "keyword" | "engine">) =>
    `${m.engine}:${normalizedKeyword(m.keyword)}`;
  // Last metric wins, observations cannot overwrite a metric with nulls.
  const candidates = new Map(
    [...metrics, ...observations].map((m) => [keyOf(m), m]),
  );
  if (!candidates.size) return new Map<string, string>();
  const [count, existing] = await Promise.all([
    tx.seoKeyword.count({ where: { domainId } }),
    tx.seoKeyword.findMany({
      where: {
        domainId,
        market,
        OR: [...candidates.values()].map((m) => ({
          engine: m.engine,
          normalizedKeyword: normalizedKeyword(m.keyword),
        })),
      },
      select: { id: true, engine: true, normalizedKeyword: true },
    }),
  ]);
  const ids = new Map(
    existing.map((k) => [`${k.engine}:${k.normalizedKeyword}`, k.id]),
  );
  let room = Math.max(0, PLAN_LIMITS[plan].seoKeywordsPerDomain - count);
  const data: Prisma.SeoKeywordCreateManyInput[] = [];
  for (const [key, m] of candidates) {
    if (ids.has(key) || room <= 0) continue;
    data.push({
      domainId,
      market,
      engine: m.engine,
      keyword: m.keyword,
      normalizedKeyword: normalizedKeyword(m.keyword),
      lastAuditId: auditId,
    });
    room--;
  }
  if (data.length) {
    await tx.seoKeyword.createMany({ data, skipDuplicates: true });
    const created = await tx.seoKeyword.findMany({
      where: {
        domainId,
        market,
        OR: data.map((m) => ({
          engine: m.engine,
          normalizedKeyword: m.normalizedKeyword,
        })),
      },
      select: { id: true, engine: true, normalizedKeyword: true },
    });
    for (const k of created)
      ids.set(`${k.engine}:${k.normalizedKeyword}`, k.id);
  }
  if (!ids.size) return ids;
  await tx.seoKeyword.updateMany({
    where: { id: { in: [...ids.values()] } },
    data: { lastAuditId: auditId, reservationOnly: false },
  });
  if (volumeSource && metrics.length) {
    const updates = new Map(metrics.map((m) => [keyOf(m), m]));
    const rows = [...updates].flatMap(([key, m]) => {
      const id = ids.get(key);
      return id ? [{ id, ...m }] : [];
    });
    if (rows.length)
      await tx.$executeRaw`
      UPDATE seo_keywords k SET search_volume = v."searchVolume",
        volume_scale = v."volumeScale", volume_period = v."volumePeriod",
        competition = v.competition, competition_raw = v."competitionRaw",
        volume_source = ${volumeSource}, metrics_updated_at = ${new Date()},
        updated_at = ${new Date()}
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS v(
        id text, "searchVolume" integer, "volumeScale" text, "volumePeriod" text,
        competition double precision, "competitionRaw" text)
      WHERE k.id = v.id AND k.domain_id = ${domainId} AND k.market = ${market}`;
  }
  return ids;
}
