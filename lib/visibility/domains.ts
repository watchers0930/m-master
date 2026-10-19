import { PLAN_LIMITS } from "@/lib/billing/limits";
import { lockOwner } from "./queries";
import { VisibilityError, notFound } from "./http";
import { prisma } from "@/lib/prisma";
import { marketSchema } from "@/lib/market/schema";
import { DEFAULT_MARKET } from "@/lib/market/constants";
import type { DomainDTO } from "@/types/visibility";
import type { z } from "zod";
import type { domainCreateSchema } from "@/schemas/visibility";
import { logAudit } from "@/lib/audit/logger";
const select = {
  id: true,
  url: true,
  market: true,
  businessType: true,
  createdAt: true,
} as const;
function dto(row: {
  id: string;
  url: string;
  market: string;
  businessType: string | null;
  createdAt: Date;
}): DomainDTO {
  return {
    ...row,
    market: marketSchema.parse(row.market),
    createdAt: row.createdAt.toISOString(),
  };
}
export async function listDomains(ownerId: string, limit: number) {
  return (
    await prisma.domain.findMany({
      where: { ownerId },
      select,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit,
    })
  ).map(dto);
}
export async function createDomain(
  ownerId: string,
  input: z.infer<typeof domainCreateSchema>,
) {
  const row = await prisma.$transaction(async (tx) => {
    const plan = await lockOwner(tx, ownerId);
    const max = PLAN_LIMITS[plan].domains;
    if (max >= 0 && await tx.domain.count({ where: { ownerId } }) >= max)
      throw new VisibilityError("rate_limited", "도메인 한도를 초과했습니다.", 429);
    const recent = await tx.auditLog.count({ where: { actor: ownerId, action: "visibility.domain.create", createdAt: { gt: new Date(Date.now() - 60000) } } });
    if (recent >= 5) throw new VisibilityError("rate_limited", "잠시 후 도메인을 등록하세요.", 429);
  const settings = await tx.setting.findUnique({
    where: { ownerId },
    select: { defaultMarket: true },
  });
  const created = await tx.domain.create({
    data: {
      ...input,
      ownerId,
      market:
        input.market ??
        marketSchema.parse(settings?.defaultMarket ?? DEFAULT_MARKET),
    },
    select,
  });
    // Durable rate-limit event in the owner-serialized transaction; deletion cannot reset it.
    await tx.auditLog.create({ data: { actor: ownerId, action: "visibility.domain.create", targetType: "domain", targetId: created.id } });
    return created;
  });
  return dto(row);
}

/** Delete policy: retain questions/history, detach the domain, deactivate queries and cancel pending reserves. */
export async function deleteDomain(ownerId: string, id: string) {
  await prisma.$transaction(async (tx) => {
    await lockOwner(tx, ownerId);
    if (!await tx.domain.findFirst({ where: { id, ownerId }, select: { id: true } })) notFound();
    await tx.visibilitySnapshot.updateMany({
      where: { query: { ownerId, domainId: id }, status: "pending" },
      data: { status: "failed", failReason: "domain_deleted" },
    });
    await tx.visibilityQuery.updateMany({ where: { ownerId, domainId: id }, data: { domainId: null, active: false } });
    await tx.domain.delete({ where: { id, ownerId } });
  });
  await logAudit({ actor: ownerId, action: "visibility.domain.delete", targetType: "domain", targetId: id });
  return { id, deleted: true as const };
}
