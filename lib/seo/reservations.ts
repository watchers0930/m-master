import { Prisma } from "@prisma/client";
import { object } from "./adapters/types";
import { releaseExpiredClaims } from "./pending";
/** Owner lock required. Paid/unfinished tasks keep capacity until their final outcome. */
export async function releaseKeywordReservations(
  tx: Prisma.TransactionClient,
  domainId: string,
) {
  await tx.$executeRaw`
    DELETE FROM seo_keywords k
    WHERE k.domain_id = ${domainId} AND k.reservation_only = true
      AND k.last_audit_id IS NULL AND k.metrics_updated_at IS NULL
      AND k.rank_observed_at IS NULL AND k.search_volume IS NULL
      AND k.volume_source IS NULL AND k.volume_scale IS NULL AND k.volume_period IS NULL
      AND k.competition IS NULL AND k.competition_raw IS NULL
      AND k.rank IS NULL AND k.rank_status IS NULL AND k.rank_source IS NULL
      AND NOT EXISTS (SELECT 1 FROM seo_rankings r WHERE r.keyword_id = k.id)
      AND NOT EXISTS (
        SELECT 1 FROM seo_tasks t JOIN seo_audits a ON a.id = t.audit_id
        WHERE a.domain_id = k.domain_id AND t.status IN ('pending', 'claimed', 'submitted')
          AND t.frozen_input->>'reservedKeywordId' = k.id
      )`;
}

export const ABANDONED_AUDIT_MS = 24 * 60 * 60 * 1000;
/** A new run may replace an untouched plan after 24h, never an in-flight paid task. */
export async function expireAbandonedAudit(
  tx: Prisma.TransactionClient,
  ownerId: string,
  domainId: string,
) {
  await releaseExpiredClaims(tx, ownerId, undefined, domainId);
  const cutoff = new Date(Date.now() - ABANDONED_AUDIT_MS);
  const audit = await tx.seoAudit.findFirst({
    where: {
      domainId,
      domain: { ownerId },
      status: "pending",
      createdAt: { lte: cutoff },
      tasks: {
        none: {
          OR: [
            { status: { in: ["claimed", "submitted", "uncertain"] } },
            { updatedAt: { gt: cutoff } },
            {
              status: "pending",
              OR: [
                { vendorTaskId: { not: null } },
                { costKrw: { gt: 0 } },
                { resultCheckpoint: { not: Prisma.DbNull } },
              ],
            },
          ],
        },
      },
    },
    select: {
      id: true,
      frozenConfig: true,
      tasks: { select: { status: true } },
    },
  });
  if (!audit) return;
  const failReason =
    "실행하지 않은 진단 예약이 만료되었습니다. 새 진단을 시작해 주세요.";
  await tx.seoTask.updateMany({
    where: { auditId: audit.id, ownerId, status: "pending" },
    data: { status: "failed", failReason, reservedKrw: 0, leaseUntil: null },
  });
  await tx.seoAudit.update({
    where: { id: audit.id },
    data: {
      status: audit.tasks.some((t) =>
        ["completed", "partial"].includes(t.status),
      )
        ? "partial"
        : "failed",
      frozenConfig: {
        ...object(audit.frozenConfig),
        autoRankings: false,
        ...(object(audit.frozenConfig).autoRankings
          ? { autoRankingsState: "expired" }
          : {}),
      },
      completedAt: new Date(),
      failReason,
    },
  });
}
