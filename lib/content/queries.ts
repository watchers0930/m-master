import { prisma } from '@/lib/prisma';
import { notFound } from '@/lib/visibility/http';
import { toSnakeCase } from '@/lib/utils/case';
import { isPublishable } from '@/lib/publish/eligibility';
import { buildPublishPreview } from '@/lib/content/publish-payload';
import type { Channel } from '@/types/db';
import type { z } from 'zod';
import type { contentListSchema } from '@/schemas/content';
export async function listContentRecords(ownerId: string, filters: z.infer<typeof contentListSchema>) {
  const { review_status, per_page, page, ...rest } = filters;
  const where = { ownerId, ...rest, reviewStatus: review_status };
  const [rows, total] = await Promise.all([
    prisma.content.findMany({ where, select: { id: true, channel: true, topic: true, status: true,
      origin: true, reviewStatus: true, reviewedAt: true, parentContentId: true, strategyContext: true,
      scores: true, costKrw: true, createdAt: true, updatedAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * per_page, take: per_page }),
    prisma.content.count({ where }),
  ]);
  return { items: rows.map(({ strategyContext, ...row }) => toSnakeCase({ ...row, hasStrategy: strategyContext !== null })), total, page, per_page };
}
export async function getContentRecord(ownerId: string, id: string) {
  const row = await prisma.content.findFirst({ where: { id, ownerId } });
  if (!row) notFound();
  const [parent, claims] = await Promise.all([
    row.parentContentId ? prisma.content.findFirst({ where: { id: row.parentContentId, ownerId }, select: { ownerId: true, reviewStatus: true } }) : null,
    prisma.publishClaim.findMany({ where: { ownerId, targetType: 'content', targetId: id,
      status: { in: ['claimed', 'sent', 'unknown'] } }, select: { status: true } }),
  ]);
  const active = claims.some(c => c.status === 'claimed' || c.status === 'unknown');
  const decision = isPublishable({ type: 'content', content: row, parent }, {
    actorOwnerId: ownerId, channel: row.channel as Channel, trigger: 'manual', now: new Date(),
    alreadySent: claims.some(c => c.status === 'sent'), activeClaimHeldByOther: active,
  });
  return { ...toSnakeCase({ ...row, strategyContext: row.strategyContext && typeof row.strategyContext === "object" && !Array.isArray(row.strategyContext) ? toSnakeCase(row.strategyContext) : null, reviewedBy: row.reviewedBy === ownerId ? ownerId : null }),
    publish: { allowed: decision.allowed, reason: decision.allowed ? null : decision.reason, active_claim: active },
    publish_preview: buildPublishPreview(row.channel as Channel, row) };
}
