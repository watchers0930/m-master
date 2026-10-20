import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { notFound } from "@/lib/visibility/http";
import { marketSchema } from "@/lib/market/schema";
import { after, decodeCursor, encodeCursor } from "@/lib/seo/pagination";

export const consultingDomainQuerySchema = z.strictObject({
    domainId: z.string().cuid().optional(),
    q: z.string().trim().max(253).default(""),
    cursor: z.string().max(1000).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
}).refine(input => !input.domainId || (!input.q && !input.cursor), "직접 조회와 검색 조건은 함께 사용할 수 없습니다.");
const select = { id: true, url: true, market: true, businessType: true, createdAt: true } as const;
export async function consultingDomains(ownerId: string, input: z.infer<typeof consultingDomainQuerySchema>) {
    const bound = { ownerId, q: input.q };
    const rows = await prisma.domain.findMany({
        where: { ownerId, ...(input.domainId ? { id: input.domainId } : {}),
            ...(input.q ? { url: { contains: input.q, mode: "insensitive" as const } } : {}),
            ...after(decodeCursor(input.cursor, bound), "createdAt") },
        select, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: input.domainId ? 1 : input.limit + 1,
    });
    if (input.domainId && !rows.length) notFound();
    const items = rows.slice(0, input.limit), last = items.at(-1);
    return { items: items.map(row => ({ ...row, market: marketSchema.parse(row.market), createdAt: row.createdAt.toISOString() })),
        nextCursor: rows.length > input.limit && last ? encodeCursor(last.createdAt, last.id, bound) : null };
}
