import { ChannelRejection } from './errors';
import { prisma } from '@/lib/prisma';
import { notFound, VisibilityError } from '@/lib/visibility/http';
import { loadTarget, claimPublish, publishError, type ClaimInput } from './claims';
import { isPublishable } from './eligibility';
import { sendChannel, type SendResult } from './channels';
import type { Channel } from '@/types/db';
export { claimPublish } from './claims';
export async function revalidateClaim(claimId: string) {
  return prisma.$transaction(async tx => {
    const claim = await tx.publishClaim.findUnique({ where: { id: claimId } });
    if (!claim || claim.status !== 'claimed') publishError('claim_invalid');
    if (claim.leaseUntil <= new Date()) publishError('claim_expired');
    const target = await loadTarget(tx, { type: claim.targetType as 'content' | 'idea_job', id: claim.targetId }, claim.ownerId);
    const decision = isPublishable(target, { actorOwnerId: claim.ownerId, channel: claim.channel as Channel,
      trigger: claim.trigger as ClaimInput['trigger'], now: new Date(), expectedVersion: claim.contentVersion ?? undefined,
      alreadySent: false, activeClaimHeldByOther: false });
    if (!decision.allowed) publishError(decision.reason === 'version_mismatch' ? 'version_changed' : 'not_publishable');
    return claim;
  });
}
export async function recordSent(claimId: string, result: SendResult, options?: { markPublished?: boolean; slotId?: string }) {
  return prisma.$transaction(async tx => {
    let claim = await tx.publishClaim.findUniqueOrThrow({ where: { id: claimId } });
    if (claim.status === 'sent') return;
    if (claim.status !== 'claimed' && !(claim.status === 'unknown' && claim.errorCode === 'lease_expired')) publishError('claim_invalid');
    await loadTarget(tx, { type: claim.targetType as 'content' | 'idea_job', id: claim.targetId }, claim.ownerId);
    claim = await tx.publishClaim.findUniqueOrThrow({ where: { id:claimId } });
    if (claim.status === 'sent') return;
    if (claim.status !== 'claimed' && !(claim.status === 'unknown' && claim.errorCode === 'lease_expired')) publishError('claim_invalid');
    const updated = await tx.publishClaim.updateMany({ where: { id: claim.id, status: claim.status }, data: {
      status: 'sent', finishedAt: new Date(), externalId: result.externalId, externalUrl: result.externalUrl,
    } });
    if (!updated.count) publishError('claim_invalid');
    if (claim.targetType === 'content') {
      if (options?.markPublished !== false) await tx.content.updateMany({ where: { id: claim.targetId, ownerId: claim.ownerId }, data: { status: 'published' } });
      const slot = options?.slotId ? await tx.scheduleSlot.findFirst({ where: { id: options.slotId, ownerId: claim.ownerId, contentId: claim.targetId }, select: { id: true } }) : claim.trigger === 'worker' ? await tx.scheduleSlot.findFirst({ where: { ownerId: claim.ownerId, contentId: claim.targetId, channel: claim.channel, status: 'scheduled' }, orderBy: { scheduledAt: 'asc' }, select: { id: true } }) : null;
      if (slot) await tx.scheduleSlot.updateMany({ where: { id: slot.id, ownerId: claim.ownerId }, data: { status: 'published', publishedAt: new Date(), ...result } });
      else await tx.scheduleSlot.create({ data: { ownerId: claim.ownerId, contentId: claim.targetId, channel: claim.channel,
        scheduledAt: new Date(), publishedAt: new Date(), status: 'published', mode: claim.trigger === 'manual' ? 'manual' : 'ai_auto', ...result } });
    } else {
      await tx.ideaPublishJob.updateMany({ where: { id: claim.targetId, ownerId: claim.ownerId }, data: {
        status: 'done', finishedAt: new Date(), externalUrl: result.externalUrl } });
    }
    await tx.auditLog.create({ data: { actor: claim.ownerId, action: `publish.${claim.channel}`, targetType: claim.targetType,
      targetId: claim.targetId, payload: { external_url: result.externalUrl ?? null } } });
  });
}
export async function executeClaim(claimId: string, send: () => Promise<SendResult>, options?: { markPublished?: boolean; slotId?: string }) {
  try { await revalidateClaim(claimId); }
  catch (error) {
    await prisma.publishClaim.updateMany({ where: { id: claimId, status: 'claimed' },
      data: { status: 'released', finishedAt: new Date(), errorCode: 'preflight_rejected' } });
    throw error;
  }
  let result: SendResult;
  try { result = await send(); }
  catch (error) {
    // Adapters may have sent the request. Unknown transport outcomes must never be retried automatically.
    const definite = error instanceof ChannelRejection || error instanceof VisibilityError && error.status < 500;
    await prisma.publishClaim.updateMany({ where: { id: claimId, status: 'claimed' }, data: {
      status: definite ? 'failed' : 'unknown', errorCode: 'channel_error', finishedAt: new Date(),
    } });
    throw new VisibilityError('channel_error', '채널 발행 결과를 확인하지 못했습니다.', 502);
  }
  await recordSent(claimId, result, options);
  return result;
}
export async function publishContentNow(input: ClaimInput & { contentId: string; destination?: string; scheduleSlotId?: string }) {
  const destinationKey = input.destination ?? input.destinationKey ?? 'default';
  if (destinationKey !== 'default' && !await prisma.cafeTarget.findFirst({ where: { id: destinationKey, ownerId: input.ownerId }, select: { id: true } })) notFound();
  if (input.scheduleSlotId && !await prisma.scheduleSlot.findFirst({ where: { id: input.scheduleSlotId, ownerId: input.ownerId, contentId: input.contentId, channel: input.channel, status: 'scheduled', scheduledAt: { lte: new Date() } }, select: { id: true } })) notFound();
  const result = await claimPublish({ type: 'content', id: input.contentId }, { ...input, destinationKey });
  if (!result.ok) publishError(result.reason);
  return executeClaim(result.claim.id, async () => {
    const row = await prisma.content.findFirst({ where: { id: input.contentId, ownerId: input.ownerId } });
    if (!row) notFound();
    return sendChannel(input.channel, row, destinationKey);
  }, { slotId: input.scheduleSlotId });
}
export async function publishIdeaJob(ownerId: string, id: string) {
  const job = await prisma.ideaPublishJob.findFirst({ where: { id, ownerId } });
  if (!job) notFound();
  const result = await claimPublish({ type: 'idea_job', id }, { ownerId, channel: job.channel as Channel, trigger: 'schedule' });
  if (!result.ok) publishError(result.reason);
  return executeClaim(result.claim.id, () => sendChannel(job.channel as Channel, {
    ownerId, topic: job.title, textBody: job.bodyHtml, imageUrl: null, bodyImageUrls: [], keywords: [],
  }, 'default'));
}

/** Acquire all destination claims before the first send; a batch shares one immutable content version. */
export async function publishContentBatch(ownerId: string, contentId: string, destinations: { id:string; name:string }[]) {
  const claims: { id:string; destination:{ id:string; name:string } }[]=[];
  try {
    for (const destination of destinations) {
      const claimed=await claimPublish({ type:'content',id:contentId },{ ownerId,channel:'naver_cafe',trigger:'manual',destinationKey:destination.id });
      if (!claimed.ok) publishError(claimed.reason);
      claims.push({ id:claimed.claim.id,destination });
    }
  } catch(error) {
    await prisma.publishClaim.updateMany({ where:{ id:{ in:claims.map(c=>c.id) },ownerId,status:'claimed' },data:{ status:'released',finishedAt:new Date() } });
    throw error;
  }
  const results: { targetId:string; name:string; articleId?:string; url?:string; error?:string }[]=[];
  let published=false;
  try {
    for (const claim of claims) {
      try {
        const result=await executeClaim(claim.id,async()=>{
          const content=await prisma.content.findFirst({ where:{ id:contentId,ownerId } });
          if (!content) notFound();
          return sendChannel('naver_cafe',content,claim.destination.id);
        },{ markPublished:false });
        published=true;
        results.push({ targetId:claim.destination.id,name:claim.destination.name,articleId:result.externalId,url:result.externalUrl });
      } catch { results.push({ targetId:claim.destination.id,name:claim.destination.name,error:'channel_error' }); }
    }
  } finally {
    if (published) await prisma.content.updateMany({ where:{ id:contentId,ownerId },data:{ status:'published' } });
  }
  return results;
}
