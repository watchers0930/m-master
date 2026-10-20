import { Prisma } from "@prisma/client";
import { citationHost } from "@/lib/visibility/normalize";
/** Read-only adapter. Current tables lack property/success/collection metadata: never infer observations from defaults. */
export async function readStoredGa4(tx: Prisma.TransactionClient, ownerId: string, host: string, range: {
    from: string;
    to: string;
}) {
    // Queries share a transaction connection; stop at the first failure.
    const daily = await tx.analyticsDaily.findFirst({ where: { ownerId, source: "ga4", date: { gte: range.from.slice(0, 10), lte: range.to.slice(0, 10) } }, select: { id: true } });
    const tests = await tx.abTest.findMany({ where: { ownerId, ga4Snapshot: { not: Prisma.DbNull }, variantA: { ownerId }, variantB: { ownerId }, completedAt: { gte: new Date(range.from), lte: new Date(range.to) } },
            select: { variantAUrl: true, variantBUrl: true }, take: 20, orderBy: [{ completedAt: "desc" }, { id: "asc" }] });
    const mapped = tests.some(t => citationHost(t.variantAUrl ?? "") === host && citationHost(t.variantBUrl ?? "") === host);
    return { status: daily || mapped ? "unmapped" : "missing",
        reason: "GA4 저장분의 property·호스트·실제 수집 성공 메타데이터가 부족합니다. 방문자·상위페이지·트래픽소스·콘텐츠 성과는 추정하지 않습니다." };
}
