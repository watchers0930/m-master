import { Prisma } from "@prisma/client";

export const CAPTURE_LEASE_MS = 300000;

/** No task/checkpoint means a paid POST cannot safely be replayed after its lease.
 * Keep the row, run key and diagnostic reason for reconciliation; release its reserve.
 * Known tasks and normalized checkpoints remain resumable.
 */
export async function expireUnrecoverablePending(
  db: Pick<Prisma.TransactionClient, "visibilitySnapshot">,
  ownerId?: string,
  now = new Date(),
) {
  return db.visibilitySnapshot.updateMany({
    where: {
      ...(ownerId ? { query: { ownerId } } : {}),
      status: "pending",
      capturedAt: { lte: new Date(now.getTime() - CAPTURE_LEASE_MS) },
      taskId: null,
      rawJson: { equals: Prisma.AnyNull },
    },
    data: { status: "failed", failReason: "submission_unrecoverable" },
  });
}
