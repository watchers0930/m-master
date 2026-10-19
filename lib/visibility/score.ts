// Pure scoring reference used by unit tests. Production GET uses DB aggregates in data.ts.
import type {
  Citation,
  EngineId,
  EngineScore,
  VisibilityDataResponse,
  CompetitorScore,
} from "@/types/visibility";
import { ENGINE_IDS } from "@/lib/market/constants";
import { citationHost } from "./normalize";
export interface ScoreSnapshot {
  engine: string;
  status: string;
  capturedAt: Date;
  citations: Citation[];
  domain: string | null;
  mentions: {
    subject: string;
    label: string;
    mentioned: boolean;
    cited: boolean;
    resolvable: boolean;
  }[];
}
export function snapshotFacts(s: ScoreSnapshot) {
  const brand = s.mentions.filter((m) => m.subject === "brand");
  const domain = s.mentions.find((m) => m.subject === "domain");
  const mentionValid =
    s.status === "ok" && brand.length > 0 && brand.every((m) => m.resolvable);
  return {
    mentionValid,
    citationValid: s.status === "ok" && domain?.resolvable === true,
    mentioned: brand.some((m) => m.mentioned),
    cited: domain?.cited === true,
  };
}
const rate = (n: number, total: number) => (total ? n / total : null);
export function score(
  snapshots: ScoreSnapshot[],
  filters: VisibilityDataResponse["filters"],
  engine?: EngineId,
): VisibilityDataResponse {
  const engines: EngineScore[] = (engine ? [engine] : ENGINE_IDS).map((id) => {
    const rows = snapshots.filter((s) => s.engine === id),
      valid = rows.filter((s) => snapshotFacts(s).mentionValid),
      citationValid = rows.filter((s) => snapshotFacts(s).citationValid);
    const mentionedCount = valid.filter(
      (s) => snapshotFacts(s).mentioned,
    ).length;
    const citedCount = citationValid.filter((s) => snapshotFacts(s).cited).length;
    return {
      engine: id,
      validSamples: valid.length,
      citationValidSamples: citationValid.length,
      mentionedCount,
      citedCount,
      sov: rate(mentionedCount, valid.length),
      citationRate: rate(citedCount, citationValid.length),
      unresolvableCount: rows.filter(
        (s) =>
          (s.status === "ok" && !snapshotFacts(s).mentionValid) ||
          s.status === "pending",
      ).length,
      failedCount: rows.filter(
        (s) => s.status === "failed" || s.status === "no_result",
      ).length,
      lastCapturedAt: rows.length
        ? new Date(
            rows.reduce(
              (latest, s) => Math.max(latest, s.capturedAt.getTime()),
              0,
            ),
          ).toISOString()
        : null,
    };
  });
  const days = new Map<string, ScoreSnapshot[]>();
  for (const row of snapshots) {
    const day = row.capturedAt.toISOString().slice(0, 10);
    const group = days.get(day) ?? [];
    group.push(row);
    days.set(day, group);
  }
  const trend = [...days]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rows]) => {
      const valid = rows.filter((s) => snapshotFacts(s).mentionValid);
      const citationValid = rows.filter((s) => snapshotFacts(s).citationValid);
      return {
        date,
        sov: rate(
          valid.filter((s) => snapshotFacts(s).mentioned).length,
          valid.length,
        ),
        citationRate: rate(
          citationValid.filter((s) => snapshotFacts(s).cited).length,
          citationValid.length,
        ),
        validSamples: valid.length,
        citationValidSamples: citationValid.length,
      };
    });
  const competitors = new Map<
    string,
    { score: CompetitorScore; valid: number }
  >();
  for (const row of snapshots.filter((s) => s.status === "ok")) {
    for (const label of new Set(
      row.mentions
        .filter((m) => m.subject === "competitor")
        .map((m) => m.label),
    )) {
      const mentions = row.mentions.filter(
        (m) => m.subject === "competitor" && m.label === label,
      );
      const entry = competitors.get(label) ?? {
        score: { label, mentionedCount: 0, mentionRate: null, cited: false },
        valid: 0,
      };
      if (mentions.every((m) => m.resolvable)) {
        entry.valid++;
        if (mentions.some((m) => m.mentioned)) entry.score.mentionedCount++;
      }
      entry.score.cited ||= mentions.some((m) => m.resolvable && m.cited);
      competitors.set(label, entry);
    }
  }
  const citations = snapshots.flatMap((s) =>
    s.status === "ok"
      ? s.citations.map((c) => ({
          ...c,
          title: c.title ?? null,
          isOwnDomain: !!s.domain && citationHost(c.url) === s.domain,
          engine: s.engine as EngineId,
          capturedAt: s.capturedAt.toISOString(),
        }))
      : [],
  );
  return {
    engines,
    trend,
    competitors: [...competitors.values()].map((c) => ({
      ...c.score,
      mentionRate: rate(c.score.mentionedCount, c.valid),
    })),
    citations,
    totalValidSamples: engines.reduce((n, e) => n + e.validSamples, 0),
    filters,
  };
}
