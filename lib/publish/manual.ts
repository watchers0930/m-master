import { prisma } from '@/lib/prisma';
import { notFound } from '@/lib/visibility/http';
import { publishContentNow, publishContentBatch } from './service';
export async function publishCafeTargets(ownerId: string, contentId: string, ids?: string[]) {
  const targets = await prisma.cafeTarget.findMany({ where: { ownerId,
    ...(ids?.length ? { id: { in: ids } } : { isDefault: true }) },
    select: { id: true, name: true }, orderBy: { createdAt: 'asc' }, take: 20 });
  if (ids?.length && targets.length !== new Set(ids).size) notFound();
  if (!targets.length) {
    const result = await publishContentNow({ ownerId, contentId, channel: 'naver_cafe', trigger: 'manual' });
    return { id: result.externalId, url: result.externalUrl };
  }
  return { results: await publishContentBatch(ownerId,contentId,targets) };
}
