import type { Channel } from '@/types/db';
export type PublishTarget =
  | { type: 'content'; content: { id: string; ownerId: string; channel: string; status: string;
      reviewStatus: string; updatedAt: Date; parentContentId: string | null };
      parent: { reviewStatus: string; ownerId: string } | null }
  | { type: 'idea_job'; job: { id: string; ownerId: string; channel: string; status: string; scheduledAt: Date | null } };
export type PublishContext = {
  actorOwnerId: string; channel: Channel; trigger: 'manual' | 'schedule' | 'worker'; now: Date;
  expectedVersion?: Date; alreadySent: boolean; activeClaimHeldByOther: boolean;
};
export type PublishBlockReason = 'owner_mismatch' | 'channel_mismatch' | 'not_approved' | 'rejected'
  | 'parent_not_approved' | 'already_published' | 'claim_held' | 'version_mismatch' | 'not_due' | 'job_not_pending';
export type PublishDecision = { allowed: true } | { allowed: false; reason: PublishBlockReason };
export function isPublishable(target: PublishTarget, ctx: PublishContext): PublishDecision {
  const fail = (reason: PublishBlockReason): PublishDecision => ({ allowed: false, reason });
  const row = target.type === 'content' ? target.content : target.job;
  if (row.ownerId !== ctx.actorOwnerId) return fail('owner_mismatch');
  if (row.channel !== ctx.channel) return fail('channel_mismatch');
  if (target.type === 'content') {
    if (target.content.reviewStatus === 'rejected') return fail('rejected');
    if (target.content.reviewStatus !== 'approved') return fail('not_approved');
    if (target.content.parentContentId && (!target.parent || target.parent.ownerId !== ctx.actorOwnerId || target.parent.reviewStatus !== 'approved')) return fail('parent_not_approved');
    if (target.content.status === 'published') return fail('already_published');
  }
  if (ctx.alreadySent) return fail('already_published');
  if (ctx.activeClaimHeldByOther) return fail('claim_held');
  if (target.type === 'content' && ctx.expectedVersion && target.content.updatedAt.getTime() !== ctx.expectedVersion.getTime()) return fail('version_mismatch');
  if (target.type === 'idea_job') {
    if (target.job.status !== 'pending') return fail('job_not_pending');
    if (ctx.trigger === 'schedule' && (!target.job.scheduledAt || target.job.scheduledAt > ctx.now)) return fail('not_due');
  }
  return { allowed: true };
}
