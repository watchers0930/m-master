import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { lockContent } from '@/lib/content/review';
import { notFound, VisibilityError } from '@/lib/visibility/http';
import { isPublishable, type PublishTarget, type PublishContext } from './eligibility';
import type { Channel } from '@/types/db';
import { getNaverCafeCreds } from '@/lib/channel-credentials';
export type TargetRef = { type: 'content' | 'idea_job'; id: string };
export type ClaimInput = { ownerId: string; channel: Channel; destinationKey?: string; trigger: 'manual' | 'schedule' | 'worker'; dailyLimit?: boolean;
  /** 예약 슬롯 발행: 같은 트랜잭션에서 슬롯을 잠그고 scheduled·도래를 재확인(slot-mutation 과 직렬화) */ slotId?: string };
export async function loadTarget(tx: Prisma.TransactionClient, ref: TargetRef, ownerId: string): Promise<PublishTarget> {
  if (ref.type === 'idea_job') {
    await tx.$queryRaw`SELECT id FROM idea_publish_jobs WHERE id = ${ref.id} AND owner_id = ${ownerId} FOR UPDATE`;
    const job = await tx.ideaPublishJob.findFirst({ where: { id: ref.id, ownerId } });
    if (!job) notFound();
    return { type: 'idea_job', job };
  }
  // Lock parent first, so approval withdrawal and child publication cannot race.
  const pointer = await tx.content.findFirst({ where: { id: ref.id, ownerId }, select: { parentContentId: true } });
  if (!pointer) notFound();
  const parent = pointer.parentContentId ? await tx.content.findFirst({ where: { id: pointer.parentContentId, ownerId }, select: { id: true } }) : null;
  const lockedParent = parent ? await lockContent(tx, ownerId, parent.id) : null;
  return { type: 'content', content: await lockContent(tx, ownerId, ref.id), parent: lockedParent };
}
export async function expireClaims() {
  await prisma.publishClaim.updateMany({ where: { status: 'claimed', leaseUntil: { lte: new Date() } },
    data: { status: 'unknown', errorCode: 'lease_expired', finishedAt: new Date() } });
}
export async function decide(tx: Prisma.TransactionClient, target: PublishTarget, ctx: PublishContext) {
  return isPublishable(target, ctx);
}
/**
 * 멱등 키 = 실제 목적지. 카페는 '기본' 게시판과 등록 대상(CafeTarget)이 같은 게시판일 수 있어, 진입점마다
 * 키가 다르면 unknown(타임아웃) 후 재시도가 같은 게시판에 중복 게시된다 → clubId:menuId 로 정규화.
 * publish_claims_active_uq 부분 유일 인덱스도 이 키로 걸리므로 DB 수준에서도 한 목적지 1건만 활성.
 */
export async function canonicalDestinationKey(ownerId: string, channel: Channel, key = 'default'): Promise<string> {
  if (channel !== 'naver_cafe') return 'default';
  const dest = key === 'default' ? await getNaverCafeCreds(ownerId)
    : await prisma.cafeTarget.findFirst({ where: { id: key, ownerId }, select: { clubId: true, menuId: true } });
  if (key !== 'default' && !dest) notFound();
  return dest?.clubId && dest.menuId ? `cafe:${dest.clubId}:${dest.menuId}` : 'default';
}
export async function claimPublish(ref: TargetRef, input: ClaimInput) {
  const ctx = { ...input, destinationKey: await canonicalDestinationKey(input.ownerId, input.channel, input.destinationKey) };
  try {
    return await prisma.$transaction(async tx => {
      if (ctx.dailyLimit) {
        await tx.$queryRaw`SELECT id FROM users WHERE id=${ctx.ownerId} FOR UPDATE`;
        const date = new Date(Date.now()+9*3600000).toISOString().slice(0,10);
        const since = new Date(date+'T00:00:00+09:00');
        const sent = await tx.publishClaim.count({ where:{ ownerId:ctx.ownerId,channel:ctx.channel,OR:[
          { status:'sent',finishedAt:{ gte:since } },{ status:{ in:['claimed','unknown'] },claimedAt:{ gte:since } },
        ] } });
        if (sent) return { ok:false as const,reason:'not_due' as const };
      }
      if (ctx.slotId) {
        const due = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM schedule_slots WHERE id = ${ctx.slotId} AND owner_id = ${ctx.ownerId}
          AND content_id = ${ref.id} AND channel = ${ctx.channel} AND status = 'scheduled' AND scheduled_at <= now() FOR UPDATE`;
        if (!due.length) return { ok: false as const, reason: 'not_due' as const };
      }
      const target = await loadTarget(tx, ref, ctx.ownerId);
      const claims = await tx.publishClaim.findMany({ where: { targetType: ref.type, targetId: ref.id,
        channel: ctx.channel, destinationKey: ctx.destinationKey, status: { in: ['claimed', 'sent', 'unknown'] } }, select: { status: true } });
      const decision = isPublishable(target, { actorOwnerId: ctx.ownerId, channel: ctx.channel, trigger: ctx.trigger,
        now: new Date(), alreadySent: claims.some(c => c.status === 'sent'), activeClaimHeldByOther: claims.some(c => c.status !== 'sent') });
      if (!decision.allowed) {
        await tx.auditLog.create({ data: { actor: ctx.ownerId, action: 'publish.blocked', targetType: ref.type,
          targetId: ref.id, payload: { reason: decision.reason } } });
        return { ok: false as const, reason: decision.reason };
      }
      const claim = await tx.publishClaim.create({ data: { ownerId: ctx.ownerId, targetType: ref.type,
        targetId: ref.id, channel: ctx.channel, destinationKey: ctx.destinationKey,
        trigger: ctx.trigger, token: randomBytes(32).toString('base64url'), leaseUntil: new Date(Date.now() + 30 * 60000),
        contentVersion: target.type === 'content' ? target.content.updatedAt : null } });
      return { ok: true as const, claim };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return { ok: false as const, reason: 'claim_held' as const };
    throw error;
  }
}
export function publishError(reason: string): never {
  throw new VisibilityError(reason === 'claim_held' ? 'publish_in_progress' : reason, '발행 조건을 확인하세요.', 409);
}
