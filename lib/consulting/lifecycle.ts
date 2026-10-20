import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lockOwner } from "@/lib/visibility/queries";

// Exceeds the route's 90s lifetime and the SDK's 60s timeout with ample grace.
export const GENERATION_LEASE_MS = 5 * 60 * 1000;

/** Caller holds the owner lock. Keep the hash; only confirmed unstarted work can acquire a fresh attempt. */
export async function expireStaleReports(tx: Prisma.TransactionClient, ownerId: string, now = new Date()) {
    const cutoff = new Date(now.getTime() - GENERATION_LEASE_MS);
    const stale = {
        ownerId, status: "generating", ledgerId: null,
        OR: [
            { startedAt: { lte: cutoff } },
            { startedAt: null, createdAt: { lte: cutoff } },
        ],
    } satisfies Prisma.ConsultingReportWhereInput;
    const rows = await tx.consultingReport.findMany({
        where: stale, select: { id: true, attemptId: true, startedAt: true },
    });
    for (const row of rows) {
        // beginAttempt can race the sweep: recheck the lease in the actual write.
        const started = row.startedAt !== null;
        const result = await tx.consultingReport.updateMany({
            where: { ...stale, id: row.id, attemptId: row.attemptId, startedAt: row.startedAt },
            data: started
                ? { status: "uncertain", failCode: "generation_uncertain" }
                : { status: "failed", failCode: "expired_unstarted", reservedKrw: 0 },
        });
        if (result.count) {
            await tx.auditLog.create({ data: {
                actor: ownerId, action: started ? "consulting.stale_uncertain" : "consulting.expired_unstarted",
                targetType: "consulting_report", targetId: row.id,
                payload: { attemptId: row.attemptId, cutoff: cutoff.toISOString() },
            } });
        }
    }
}

/** Commit independently so a later denied reservation cannot undo recovery. */
export async function reconcileStaleReports(ownerId: string) {
    await prisma.$transaction(async tx => {
        await lockOwner(tx, ownerId);
        await expireStaleReports(tx, ownerId);
    });
}
