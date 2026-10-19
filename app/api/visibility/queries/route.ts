import { NextResponse } from "next/server";
import { encodeCursor } from "@/lib/visibility/cursor";
import { prisma } from "@/lib/prisma";
import { authenticated, jsonOk, queryParams } from "@/lib/visibility/http";
import { queryCreateSchema, queryListSchema } from "@/schemas/visibility";
import { createQuery, querySelect, queryDTO } from "@/lib/visibility/queries";
export async function GET(request: Request) {
  return authenticated(async (ownerId) => {
    const { limit, cursor, ...filter } = queryListSchema.parse(queryParams(request));
    const rows = await prisma.visibilityQuery.findMany({
      where: { ownerId, ...filter, ...(cursor ? { OR: [
        { createdAt: { lt: new Date(cursor.at) } },
        { createdAt: new Date(cursor.at), id: { gt: cursor.id } },
      ] } : {}) },
      select: querySelect,
      take: limit + 1,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
    const page = rows.slice(0, limit), last = page.at(-1);
    return NextResponse.json({ data: page.map(queryDTO), nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null });
  });
}
export async function POST(request: Request) {
  return authenticated(
    async (ownerId) =>
      jsonOk(
        await createQuery(
          ownerId,
          queryCreateSchema.parse(await request.json()),
        ),
        201,
      ),
    request,
  );
}
