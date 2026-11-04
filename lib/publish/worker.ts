import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { getTodayKST } from '@/lib/cron/auth';
import { VisibilityError } from '@/lib/visibility/errors';
import { expireClaims, publishError, loadTarget } from './claims';
import { revalidateClaim, recordSent } from './service';
import { workerOwners } from './worker-auth';
import { isPublishable } from './eligibility';
import { deriveCafeContent } from './derive';
export async function pendingBlogContent() {
  const owners = workerOwners(), date = getTodayKST();
  const empty = (reason: string) => ({ items: [], date, skipped: reason === 'daily_limit_reached', reason });
  await expireClaims();
  if (!owners.length) return empty('owner_allowlist_empty');
  let limited = false;
  for (const ownerId of owners) {
    const item = await prisma.$transaction(async tx => {
      // Serialize owner/day selection, including different candidate contents.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${ownerId} FOR UPDATE`;
      const dayStart = new Date(date + 'T00:00:00+09:00');
      const daily = await tx.publishClaim.findFirst({ where: { ownerId, channel: 'blog', OR: [
        { status: 'sent', finishedAt: { gte: dayStart } }, { status: 'claimed' }, { status: 'unknown', claimedAt: { gte: dayStart } },
      ] }, select: { id: true } });
      if (daily) { limited = true; return null; }
      const eligible=await tx.$queryRaw<{ id:string }[]>`SELECT c.id FROM contents c
        WHERE c.owner_id=${ownerId} AND c.channel='blog' AND c.status='draft' AND c.review_status='approved'
        AND NOT EXISTS (SELECT 1 FROM publish_claims p WHERE p.target_type='content' AND p.target_id=c.id
          AND p.channel='blog' AND p.status IN ('claimed','sent','unknown'))
        AND NOT EXISTS (SELECT 1 FROM schedule_slots s WHERE s.content_id=c.id AND s.owner_id=${ownerId}
          AND s.channel='blog' AND s.status='published')
        ORDER BY c.reviewed_at ASC NULLS LAST,c.created_at ASC,c.id ASC LIMIT 1`;
      const row=eligible.length ? await tx.content.findFirst({where:{id:eligible[0].id,ownerId}}) : null;
      if (!row) return null;
      const target = await loadTarget(tx, { type: 'content', id: row.id }, ownerId);
      const decision = isPublishable(target, { actorOwnerId: ownerId, channel: 'blog', trigger: 'worker',
        now: new Date(), alreadySent: false, activeClaimHeldByOther: false });
      if (!decision.allowed) return null;
      const locked = await tx.content.findFirstOrThrow({ where:{ id:row.id,ownerId } });
      const claim = await tx.publishClaim.create({ data: { ownerId, targetType: 'content', targetId: row.id,
        channel: 'blog', trigger: 'worker', token: randomBytes(32).toString('base64url'),
        contentVersion: locked.updatedAt, leaseUntil: new Date(Date.now() + 30 * 60000) } });
      return { id: locked.id, ownerId, topic: locked.topic, textBody: locked.textBody, imageUrl: locked.imageUrl,
        bodyImageUrls: locked.bodyImageUrls, keywords: locked.keywords, claim: {
          token: claim.token, contentVersion: claim.contentVersion, expiresAt: claim.leaseUntil } };
    });
    if (item) return { items: [item], date, skipped: false, reason: null };
  }
  return empty(limited ? 'daily_limit_reached' : 'no_eligible_content');
}
async function ownedClaim(contentId: string, token: string) {
  const claim = await prisma.publishClaim.findFirst({ where: { token, targetType: 'content', targetId: contentId,
    channel: 'blog', trigger: 'worker', ownerId: { in: workerOwners() } } });
  if (!claim) publishError('claim_invalid');
  return claim;
}
export async function verifyWorkerClaim(contentId: string, token: string) {
  const claim = await ownedClaim(contentId, token);
  try { await revalidateClaim(claim.id); } catch(error) {
    if (error instanceof VisibilityError && error.code==='not_found') publishError('not_publishable');
    throw error;
  }
  const expiresAt = new Date(Math.max(claim.leaseUntil.getTime(), Date.now() + 10 * 60000));
  const updated = await prisma.publishClaim.updateMany({ where: { id: claim.id, status: 'claimed', leaseUntil: { gt: new Date(), lt: expiresAt } }, data: { leaseUntil: expiresAt } });
  if (!updated.count) {
    const current = await ownedClaim(contentId, token);
    if (current.status !== 'claimed' || current.leaseUntil <= new Date()) publishError('claim_expired');
    return { ok: true, expiresAt: current.leaseUntil };
  }
  return { ok: true, expiresAt };
}
export async function completeWorkerClaim(contentId: string, token: string, externalUrl: string) {
  const claim = await ownedClaim(contentId, token);
  if (claim.status !== 'sent') {
    await recordSent(claim.id, { externalUrl });
  }
  let cafe: Awaited<ReturnType<typeof deriveCafeContent>> | { status: 'skipped'; reason: string };
  try { cafe = await deriveCafeContent(claim.ownerId, contentId); }
  catch { cafe = { status: 'skipped', reason: 'derive_failed' }; }
  return { ok: true, cafe };
}
export async function failWorkerClaim(contentId: string, token: string, outcome: 'not_posted' | 'unknown') {
  const claim = await ownedClaim(contentId, token);
  const target = outcome === 'not_posted' ? 'released' : 'unknown';
  if (claim.status === target) return { ok: true };
  const changed = await prisma.publishClaim.updateMany({ where: { id: claim.id, ownerId: claim.ownerId, status: 'claimed' },
    data: { status: target, finishedAt: new Date(), errorCode: outcome } });
  if (!changed.count) publishError('claim_invalid');
  return { ok: true };
}
