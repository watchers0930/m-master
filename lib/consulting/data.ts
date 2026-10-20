import { Prisma, type ConsultingReport } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notFound, VisibilityError } from "@/lib/visibility/http";
import { marketSchema } from "@/lib/market/schema";
import { consultingSnapshotSchema, consultingStrategySchema } from "@/schemas/consulting";
import type { consultingQuerySchema } from "@/schemas/consulting";
import type { ConsultingReportDTO, ConsultingReportSummaryDTO, ConsultingSnapshot } from "@/types/consulting";
import type { z } from "zod";
import { after, decodeCursor, encodeCursor } from "@/lib/seo/pagination";
import { lockOwner } from "@/lib/visibility/queries";
import { reserveBudget } from "./budget";
import { expireStaleReports, reconcileStaleReports } from "./lifecycle";

const historySelect = {
    id: true, domainId: true, market: true, status: true, failCode: true,
    diagnosisSummary: true, budgetProposal: true,
    schemaVersion: true, promptVersion: true, model: true, createdAt: true, generatedAt: true,
} satisfies Prisma.ConsultingReportSelect;

function reportSummaryDto(row: Prisma.ConsultingReportGetPayload<{ select: typeof historySelect }>): ConsultingReportSummaryDTO {
    return {
        ...row, market: marketSchema.parse(row.market), status: row.status as ConsultingReportSummaryDTO["status"],
        diagnosisSummary: row.status === "completed" ? row.diagnosisSummary : null,
        budgetProposal: row.status === "completed" ? consultingStrategySchema.shape.budgetProposal.parse(row.budgetProposal) : null,
        createdAt: row.createdAt.toISOString(), generatedAt: row.generatedAt?.toISOString() ?? null,
    };
}
export async function ownedDomain(ownerId: string, id: string) {
    const d = await prisma.domain.findFirst({ where: { id, ownerId }, select: { id: true, url: true, market: true } });
    if (!d)
        notFound();
    return { ...d, market: marketSchema.parse(d.market) };
}
export function reportDto(row: ConsultingReport): ConsultingReportDTO {
    const snapshot = consultingSnapshotSchema.parse(row.inputSnapshot);
    const strategy = row.status === "completed" ? consultingStrategySchema.parse(row.strategyJson) : null;
    return {
        id: row.id, domainId: row.domainId, market: marketSchema.parse(row.market),
        status: row.status as ConsultingReportDTO["status"], failCode: row.failCode,
        diagnosis: strategy?.diagnosis ?? null, channelMix: strategy?.channelMix ?? null,
        budgetProposal: strategy?.budgetProposal ?? null, priorityActions: strategy?.priorityActions ?? null,
        limitations: snapshot.limitations, sourceStatus: snapshot.sourceStatus, evidence: snapshot.evidence, range: snapshot.range,
        schemaVersion: row.schemaVersion, promptVersion: row.promptVersion, model: row.model,
        createdAt: row.createdAt.toISOString(), generatedAt: row.generatedAt?.toISOString() ?? null,
    };
}
export async function getReports(ownerId: string, input: z.infer<typeof consultingQuerySchema>) {
    await ownedDomain(ownerId, input.domainId);
    await reconcileStaleReports(ownerId);
    const where = { ownerId, domainId: input.domainId, domain: { ownerId } };
    if (input.reportId) {
        const row = await prisma.consultingReport.findFirst({ where: { ...where, id: input.reportId } });
        if (!row)
            notFound();
        return reportDto(row);
    }
    const bound = { ownerId, domainId: input.domainId };
    const rows = await prisma.consultingReport.findMany({ where: { ...where, ...after(decodeCursor(input.cursor, bound), "createdAt") },
        select: historySelect,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: input.limit + 1 });
    const items = rows.slice(0, input.limit), last = items.at(-1);
    return { items: items.map(reportSummaryDto), nextCursor: rows.length > input.limit && last ? encodeCursor(last.createdAt, last.id, bound) : null };
}
/** Replay only when non-execution is certain. A charged or uncertain attempt is never replaced. */
export function canRetry(row: ConsultingReport) {
    return row.status === "failed" && row.ledgerId === null && row.reservedKrw === 0 &&
        (row.startedAt === null || row.failCode === "request_rejected");
}
export function existingResult(row: ConsultingReport) {
    if (row.status === "completed")
        return { data: reportDto(row), reused: true };
    const code = row.status === "generating" ? "generation_in_progress" : row.status === "uncertain" ? "generation_uncertain" : "llm_failed";
    const error = new VisibilityError(code, row.status === "generating" ? "동일 입력의 리포트를 생성 중입니다." : "기존 생성 결과를 확인하세요.", row.status === "failed" ? 502 : 409);
    return Object.assign(error, { reportId: row.id });
}
export async function findExisting(ownerId: string, domainId: string, hash: string) {
    await reconcileStaleReports(ownerId);
    return prisma.consultingReport.findFirst({ where: { ownerId, domainId, inputSnapshotHash: hash, domain: { ownerId } } });
}
export async function claimReport(ownerId: string, domainId: string, snapshot: ConsultingSnapshot, hash: string, versions: {
    schemaVersion: string;
    promptVersion: string;
    model: string;
}, attemptId: string, reserve: number) {
    return prisma.$transaction(async (tx) => {
        const plan = await lockOwner(tx, ownerId);
        await expireStaleReports(tx, ownerId);
        const domain = await tx.domain.findFirst({ where: { id: domainId, ownerId, market: snapshot.market }, select: { id: true } });
        if (!domain)
            notFound();
        const existing = await tx.consultingReport.findFirst({ where: { domainId, ownerId, market: snapshot.market, inputSnapshotHash: hash } });
        if (existing && !canRetry(existing))
            return { row: existing, claimed: false };
        await reserveBudget(tx, ownerId, plan, reserve);
        const data = { ownerId, domainId, market: snapshot.market, ...versions, attemptId,
            inputSnapshotHash: hash, inputSnapshot: snapshot as unknown as Prisma.InputJsonValue,
            status: "generating", failCode: null, startedAt: null, createdAt: new Date(), reservedKrw: reserve,
            costKrw: 0, ledgerId: null, generatedAt: null, diagnosisSummary: null,
            strategyJson: Prisma.DbNull, budgetProposal: Prisma.DbNull, priorityActions: Prisma.DbNull };
        // Owner serialization makes the retry and its fresh reservation one atomic claim.
        const row = existing
            ? await tx.consultingReport.update({ where: { id: existing.id }, data })
            : await tx.consultingReport.create({ data });
        await tx.auditLog.create({ data: { actor: ownerId, action: "consulting.reserve", targetType: "consulting_report", targetId: row.id, payload: { attemptId } } });
        return { row, claimed: true };
    });
}
export async function beginAttempt(ownerId: string, id: string, attemptId: string) {
    const result = await prisma.consultingReport.updateMany({ where: { id, ownerId, attemptId, status: "generating", startedAt: null, ledgerId: null }, data: { startedAt: new Date() } });
    if (result.count !== 1)
        throw new VisibilityError("generation_uncertain", "생성 상태를 확인하세요.", 409);
}
