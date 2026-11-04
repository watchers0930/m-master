import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { notFound, VisibilityError } from '@/lib/visibility/http';
import type { ContentEditInput, ContentReviewInput } from '@/schemas/content';

export const ACTIVE_CLAIMS = ['claimed', 'sent', 'unknown'];
export function contentConflict(code: string, updatedAt?: Date): never {
  const error = new VisibilityError(code, '콘텐츠 상태가 변경되었습니다. 최신 내용을 확인하세요.', 409);
  throw Object.assign(error, updatedAt ? { details: { updated_at: updatedAt.toISOString() } } : {});
}
/** All editors and publishers take this row lock before reading state. */
export async function lockContent(tx: Prisma.TransactionClient, ownerId: string, id: string) {
  await tx.$queryRaw`SELECT id FROM contents WHERE id = ${id} AND owner_id = ${ownerId} FOR UPDATE`;
  const row = await tx.content.findFirst({ where: { id, ownerId } });
  if (!row) notFound();
  return row;
}
export async function assertNoPublishClaim(tx: Prisma.TransactionClient, ownerId: string, id: string) {
  const claims = await tx.$queryRaw<{ id: string }[]>`SELECT p.id FROM publish_claims p
    WHERE p.owner_id=${ownerId} AND p.target_type='content' AND p.status IN ('claimed','unknown')
    AND (p.target_id=${id} OR EXISTS (SELECT 1 FROM contents c WHERE c.id=p.target_id
      AND c.owner_id=${ownerId} AND c.parent_content_id=${id})) LIMIT 1`;
  if (claims.length) contentConflict('publish_in_progress');
}
export function nextContentVersion(previous: Date) {
  return new Date(Math.max(Date.now(), previous.getTime() + 1));
}
async function audit(tx: Prisma.TransactionClient, ownerId: string, id: string, action: string, payload?: Prisma.InputJsonValue) {
  await tx.auditLog.create({ data: { actor: ownerId, targetType: 'content', targetId: id, action, payload } });
}
export async function reviewContentRecord(ownerId: string, id: string, input: ContentReviewInput) {
  return prisma.$transaction(async tx => {
    const row = await lockContent(tx, ownerId, id);
    await assertNoPublishClaim(tx, ownerId, id);
    const target = { approve: 'approved', reject: 'rejected', request_review: 'pending_review' }[input.decision];
    if (row.reviewStatus === target) return { ...row, changed: false };
    if (row.updatedAt.getTime() !== Date.parse(input.expected_updated_at)) contentConflict('version_conflict', row.updatedAt);
    if (input.decision !== 'request_review' && row.reviewStatus !== 'pending_review') contentConflict('invalid_transition');
    const result = await tx.content.updateMany({ where: { id, ownerId, updatedAt: row.updatedAt }, data: {
      reviewStatus: target, updatedAt: nextContentVersion(row.updatedAt),
      reviewedAt: target === 'pending_review' ? null : new Date(),
      reviewedBy: target === 'pending_review' ? null : ownerId,
    } });
    if (result.count !== 1) contentConflict('version_conflict');
    await audit(tx, ownerId, id, `content.review_${input.decision === 'request_review' ? 'request' : input.decision}`, { reason: input.reason ?? null });
    const updated = await tx.content.findFirstOrThrow({ where: { id, ownerId } });
    return { ...updated, changed: true };
  });
}
export async function editContentRecord(ownerId: string, id: string, input: ContentEditInput) {
  return updateContentBody(ownerId, id, new Date(input.expected_updated_at), {
    topic: input.topic, textBody: input.text_body, keywords: input.keywords,
  });
}
export async function updateContentBody(ownerId: string, id: string, expected: Date,
  data: Pick<Prisma.ContentUpdateManyMutationInput, 'topic' | 'textBody' | 'keywords' | 'bodyImageUrls'>) {
  return prisma.$transaction(async tx => {
    const row = await lockContent(tx, ownerId, id);
    await assertNoPublishClaim(tx, ownerId, id);
    if (row.status === 'published') contentConflict('already_published');
    if (row.updatedAt.getTime() !== expected.getTime()) contentConflict('version_conflict', row.updatedAt);
    const reset = row.origin === 'auto' && row.reviewStatus === 'approved';
    const changed = await tx.content.updateMany({ where: { id, ownerId, updatedAt: expected }, data: {
      ...data, updatedAt: nextContentVersion(row.updatedAt),
      ...(reset ? { reviewStatus: 'pending_review', reviewedAt: null, reviewedBy: null } : {}),
    } });
    if (changed.count !== 1) contentConflict('version_conflict');
    await audit(tx, ownerId, id, 'content.edit');
    if (reset) await audit(tx, ownerId, id, 'content.review_reset');
  });
}
