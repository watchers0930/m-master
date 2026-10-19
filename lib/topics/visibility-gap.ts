import { prisma } from "@/lib/prisma";
import type { Market } from "@/types/visibility";
import type { Candidate } from "./candidates";
import { snapshotFacts } from "@/lib/visibility/score";
export interface VisibilityGapEvidence {
  sourceQueryId: string;
  market: string;
  domainId: string | null;
  observedAt: string;
  validEngineCount: number;
}
/** Latest result per engine within the current comparison window. Failed samples never imply absence. */
export async function visibilityGapCandidates(
  ownerId: string,
  market: Market = "ko-KR",
): Promise<Candidate[]> {
  const queries = await prisma.visibilityQuery.findMany({
    where: { ownerId, market, active: true },
    select: {
      id: true,
      query: true,
      domainId: true,
      market: true,
      snapshots: {
        where: { capturedAt: { gte: new Date(Date.now() - 30 * 86400000) } },
        orderBy: { capturedAt: "desc" },
        distinct: ["engine"],
        select: {
          engine: true,
          status: true,
          capturedAt: true,
          mentions: {
            select: {
              subject: true,
              label: true,
              mentioned: true,
              cited: true,
              resolvable: true,
            },
          },
        },
      },
    },
    take: 100,
    orderBy: { createdAt: "desc" },
  });
  return queries
    .flatMap((q) => {
      const valid = q.snapshots.filter(
        (s) => snapshotFacts({ ...s, citations: [], domain: null }).mentionValid,
      );
      if (
        !valid.length ||
        valid.some((s) =>
          s.mentions.some(
            (m) => m.subject === "brand" && m.resolvable && m.mentioned,
          ),
        )
      )
        return [];
      return [
        {
          topic: q.query.slice(0, 80),
          signal: "ai_visibility_gap" as const,
          weight: 10,
          factors: {
            sourceQueryId: q.id,
            market: q.market,
            domainId: q.domainId,
            observedAt: valid[0].capturedAt.toISOString(),
            validEngineCount: valid.length,
          },
        },
      ];
    })
    .slice(0, 7);
}
