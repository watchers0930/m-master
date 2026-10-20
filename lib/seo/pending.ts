import { Prisma } from "@prisma/client";
/** A crashed worker may have submitted before receiving an ID. Never automatically re-POST. */
export async function recoverExpired(
  tx: Prisma.TransactionClient,
  ownerId: string,
  auditId: string,
) {
  await releaseExpiredClaims(tx, ownerId, auditId);
  await tx.seoTask.updateMany({
    where: {
      ownerId,
      auditId,
      status: "claimed",
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }],
    },
    data: {
      status: "submitted",
      leaseUntil: null,
      claimVersion: { increment: 1 },
    },
  });
  const expired = {
    ownerId,
    auditId,
    status: "submitted",
    OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }],
  };
  await tx.seoTask.updateMany({
    where: {
      ...expired,
      vendorTaskId: null,
      resultCheckpoint: { equals: Prisma.DbNull },
    },
    data: {
      status: "uncertain",
      failReason: "submission_uncertain",
      leaseUntil: null,
      claimVersion: { increment: 1 },
    },
  });
}

/** Safe cleanup also runs before replacing an audit or deleting a domain. */
export async function releaseExpiredClaims(
  tx: Prisma.TransactionClient,
  ownerId: string,
  auditId?: string,
  domainId?: string,
) {
  // A claim is not permission to POST until beginExecution commits. Invalidate stale workers.
  await tx.seoTask.updateMany({
    where: {
      ownerId,
      auditId,
      ...(domainId ? { audit: { domainId, domain: { ownerId } } } : {}),
      status: "claimed",
      vendorTaskId: null,
      resultCheckpoint: { equals: Prisma.DbNull },
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }],
    },
    data: {
      status: "pending",
      reservedKrw: 0,
      leaseUntil: null,
      claimVersion: { increment: 1 },
    },
  });
}
