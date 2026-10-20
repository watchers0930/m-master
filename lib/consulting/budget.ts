import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkFeatureAccess, type PlanKey } from "@/lib/billing/limits";
import { checkSeoBudget } from "@/lib/seo/budget";
import { lockOwner } from "@/lib/visibility/queries";
import { VisibilityError } from "@/lib/visibility/http";
import type { ConsultingStrategy } from "@/types/consulting";
import type { ChatUsage } from "@/lib/claude/chat";
/** Optional deployment policy; absent policy imposes no invented commercial quota. */
export async function reserveBudget(tx: Prisma.TransactionClient, ownerId: string, plan: PlanKey, amount: number) {
    try {
        checkFeatureAccess(plan, "consulting");
    }
    catch {
        throw new VisibilityError("feature_forbidden", "마케팅 컨설팅은 Starter 플랜부터 사용할 수 있습니다.", 403);
    }
    await checkSeoBudget(tx, ownerId, plan, amount);
    const limit = process.env.CONSULTING_GENERATION_LIMIT;
    if (limit !== undefined) {
        const count = Number(limit), seconds = Number(process.env.CONSULTING_GENERATION_WINDOW_SECONDS);
        if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(seconds) || seconds < 1)
            throw new VisibilityError("rate_limited", "생성 제한 설정을 확인할 수 없습니다.", 429);
        // INSERT-only audit events survive failure, retries and domain/report deletion.
        // claimReport appends this event under the same owner lock as this count.
        const recent = await tx.auditLog.count({ where: { actor: ownerId, action: "consulting.reserve",
            createdAt: { gte: new Date(Date.now() - seconds * 1000) } } });
        if (recent >= count)
            throw new VisibilityError("rate_limited", "잠시 후 리포트를 생성하세요.", 429);
    }
}
export async function settleReport(ownerId: string, id: string, attemptId: string, usage: ChatUsage, krw: number, strategy: ConsultingStrategy | null) {
    return prisma.$transaction(async (tx) => {
        await lockOwner(tx, ownerId);
        const row = await tx.consultingReport.findFirst({ where: { id, ownerId, attemptId } });
        if (!row)
            throw new Error("missing settlement");
        if (row.ledgerId)
            return row;
        if (!row.startedAt || !["generating", "uncertain"].includes(row.status))
            throw new Error("invalid settlement state");
        const ledger = await tx.costLedger.create({ data: { ownerId, kind: "consulting", tokensIn: usage.prompt_tokens, tokensOut: usage.completion_tokens, krw } });
        const updated = await tx.consultingReport.update({ where: { id }, data: {
                status: strategy ? "completed" : "failed", failCode: strategy ? null : "llm_failed",
                ledgerId: ledger.id, costKrw: krw, reservedKrw: 0,
                diagnosisSummary: strategy?.diagnosis.summary ?? null,
                strategyJson: strategy ? strategy as unknown as Prisma.InputJsonValue : Prisma.DbNull,
                budgetProposal: strategy ? strategy.budgetProposal as unknown as Prisma.InputJsonValue : Prisma.DbNull,
                priorityActions: strategy ? strategy.priorityActions as unknown as Prisma.InputJsonValue : Prisma.DbNull,
                generatedAt: strategy ? new Date() : null,
            } });
        await tx.auditLog.create({ data: { actor: ownerId, action: `consulting.${updated.status}`, targetType: "consulting_report", targetId: id, payload: { attemptId, ledgerId: ledger.id } } });
        return updated;
    });
}
export async function markUncertain(ownerId: string, id: string, attemptId: string) {
    // Never release the reservation when the request may have been billed.
    await prisma.$transaction(async (tx) => {
        await lockOwner(tx, ownerId);
        const result = await tx.consultingReport.updateMany({ where: { id, ownerId, attemptId, ledgerId: null, status: "generating" }, data: { status: "uncertain", failCode: "generation_uncertain" } });
        if (result.count)
            await tx.auditLog.create({ data: { actor: ownerId, action: "consulting.uncertain", targetType: "consulting_report", targetId: id, payload: { attemptId } } });
    });
}

/** A provider pre-execution rejection is safe to release, including for a later fresh attempt. */
export async function markRejected(ownerId: string, id: string, attemptId: string) {
    await prisma.$transaction(async tx => {
        await lockOwner(tx, ownerId);
        const result = await tx.consultingReport.updateMany({
            where: { id, ownerId, attemptId, ledgerId: null, status: { in: ["generating", "uncertain"] } },
            data: { status: "failed", failCode: "request_rejected", reservedKrw: 0 },
        });
        if (result.count !== 1) throw new Error("rejection state changed");
        await tx.auditLog.create({ data: { actor: ownerId, action: "consulting.rejected",
            targetType: "consulting_report", targetId: id, payload: { attemptId } } });
    });
}
