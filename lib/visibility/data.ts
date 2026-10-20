import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { dataSchema } from "@/schemas/visibility";
import { ENGINE_IDS } from "@/lib/market/constants";
import type { CitationItem, CompetitorScore, VisibilityDataResponse } from "@/types/visibility";
import { citationHost } from "./normalize";
import { encodeCursor } from "./cursor";
const rate = (n: number, d: number) => d ? n / d : null;
type Counts = { engine: string; day: string | null; valid: number; citationValid: number; mentioned: number; cited: number; unresolved: number; failed: number; latest: Date };
export async function visibilityData(ownerId: string, filter: z.infer<typeof dataSchema>, db: Pick<Prisma.TransactionClient, "$queryRaw"> = prisma): Promise<VisibilityDataResponse> {
  const { market, queryId, domainId, engine, from, to, citationLimit, citationCursor } = filter;
  // All sample facts and denominators stay in PostgreSQL; no snapshot/mention hydration.
  const base = Prisma.sql`WITH filtered AS (
    SELECT s.*, CASE WHEN s.capture_config IS NULL THEN d.url ELSE s.capture_config->>'domain' END AS captured_domain
    FROM visibility_snapshots s JOIN visibility_queries q ON q.id = s.query_id
    LEFT JOIN domains d ON d.id=q.domain_id
    WHERE q.owner_id = ${ownerId}
      AND COALESCE(s.capture_config->>'market', q.market) = ${market}
      AND s.captured_at >= ${from} AND s.captured_at <= ${to}
      ${queryId ? Prisma.sql`AND q.id = ${queryId}` : Prisma.empty}
      ${domainId ? Prisma.sql`AND (CASE WHEN s.capture_config IS NULL THEN q.domain_id ELSE s.capture_config->>'domainId' END) = ${domainId}` : Prisma.empty}
      ${engine ? Prisma.sql`AND s.engine = ${engine}` : Prisma.empty}
  )`;
  const [counts, competitors, page] = await Promise.all([
    db.$queryRaw<Counts[]>(Prisma.sql`${base}, facts AS (
      SELECT s.id, s.engine, s.captured_at, s.status,
        s.status = 'ok' AND EXISTS (SELECT 1 FROM visibility_mentions m WHERE m.snapshot_id=s.id AND m.subject='brand')
          AND NOT EXISTS (SELECT 1 FROM visibility_mentions m WHERE m.snapshot_id=s.id AND m.subject='brand' AND NOT m.resolvable) AS valid,
        s.status = 'ok' AND EXISTS (SELECT 1 FROM visibility_mentions m WHERE m.snapshot_id=s.id AND m.subject='domain' AND m.resolvable) AS cv,
        EXISTS (SELECT 1 FROM visibility_mentions m WHERE m.snapshot_id=s.id AND m.subject='brand' AND m.mentioned) AS mentioned,
        EXISTS (SELECT 1 FROM visibility_mentions m WHERE m.snapshot_id=s.id AND m.subject='domain' AND m.resolvable AND m.cited) AS cited
      FROM filtered s
    ) SELECT engine, to_char(captured_at, 'YYYY-MM-DD') AS day,
      (count(*) FILTER (WHERE valid))::int AS valid,
      (count(*) FILTER (WHERE cv))::int AS "citationValid",
      (count(*) FILTER (WHERE valid AND mentioned))::int AS mentioned,
      (count(*) FILTER (WHERE cv AND cited))::int AS cited,
      (count(*) FILTER (WHERE (status='ok' AND NOT valid) OR status='pending'))::int AS unresolved,
      (count(*) FILTER (WHERE status IN ('failed','no_result')))::int AS failed,
      max(captured_at) AS latest
    FROM facts GROUP BY GROUPING SETS ((engine), (engine, to_char(captured_at, 'YYYY-MM-DD')))`),
    db.$queryRaw<CompetitorScore[]>(Prisma.sql`${base}, subjects AS (
      SELECT s.id, m.label, bool_and(m.resolvable) AS valid, bool_or(m.mentioned) AS mentioned,
        bool_or(m.resolvable AND m.cited) AS cited
      FROM filtered s JOIN visibility_mentions m ON m.snapshot_id=s.id
      WHERE s.status='ok' AND m.subject='competitor' GROUP BY s.id, m.label
    ) SELECT label, (count(*) FILTER (WHERE valid AND mentioned))::int AS "mentionedCount",
      (count(*) FILTER (WHERE valid AND mentioned))::float / NULLIF(count(*) FILTER (WHERE valid),0) AS "mentionRate",
      bool_or(cited) AS cited FROM subjects GROUP BY label ORDER BY "mentionedCount" DESC, label LIMIT 100`),
    db.$queryRaw<(CitationItem & { id: string; ordinal: number; domain: string | null })[]>(Prisma.sql`${base}
      SELECT s.id, c.ordinality::int AS ordinal, c.item->>'url' AS url, c.item->>'title' AS title,
        (c.item->>'position')::int AS position, s.engine, s.captured_at AS "capturedAt",
        s.captured_domain AS domain
      FROM filtered s CROSS JOIN LATERAL jsonb_array_elements(s.citations) WITH ORDINALITY c(item, ordinality)
      WHERE s.status='ok'
      ${citationCursor ? Prisma.sql`AND (s.captured_at, s.id, c.ordinality) > (${new Date(citationCursor.at)}, ${citationCursor.id}, ${citationCursor.offset})` : Prisma.empty}
      ORDER BY s.captured_at, s.id, c.ordinality LIMIT ${citationLimit + 1}`),
  ]);
  const engines = (engine ? [engine] : ENGINE_IDS).map((id) => {
    const r = counts.find((r) => r.engine === id && r.day === null);
    const valid = r?.valid ?? 0, cv = r?.citationValid ?? 0, mentioned = r?.mentioned ?? 0, cited = r?.cited ?? 0;
    return { engine: id, validSamples: valid, citationValidSamples: cv, mentionedCount: mentioned, citedCount: cited,
      sov: rate(mentioned, valid), citationRate: rate(cited, cv), unresolvableCount: r?.unresolved ?? 0,
      failedCount: r?.failed ?? 0, lastCapturedAt: r?.latest.toISOString() ?? null };
  });
  const days = new Map<string, { valid: number; cv: number; mentioned: number; cited: number }>();
  for (const r of counts) if (r.day) {
    const d = days.get(r.day) ?? { valid: 0, cv: 0, mentioned: 0, cited: 0 };
    d.valid += r.valid; d.cv += r.citationValid; d.mentioned += r.mentioned; d.cited += r.cited; days.set(r.day, d);
  }
  const visible = page.slice(0, citationLimit), last = visible.at(-1);
  return { engines, competitors,
    trend: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, d]) => ({ date, sov: rate(d.mentioned, d.valid), citationRate: rate(d.cited, d.cv), validSamples: d.valid, citationValidSamples: d.cv })),
    citations: visible.map(({ id: _id, ordinal: _ordinal, domain, ...c }) => ({ ...c, isOwnDomain: !!domain && citationHost(c.url) === domain, capturedAt: new Date(c.capturedAt).toISOString() })),
    nextCitationCursor: page.length > citationLimit && last ? encodeCursor(new Date(last.capturedAt), last.id, last.ordinal) : null,
    totalValidSamples: engines.reduce((sum, e) => sum + e.validSamples, 0),
    filters: { market, queryId: queryId ?? null, domainId: domainId ?? null, from: from.toISOString(), to: to.toISOString() },
  };
}
