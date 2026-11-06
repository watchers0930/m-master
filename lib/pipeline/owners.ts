import type { Prisma } from '@prisma/client';
import { VisibilityError } from '@/lib/visibility/errors';
import { prisma } from '@/lib/prisma';
/** Paid plans that may run the automatic pipeline (same entitlement source as lib/billing/limits.ts: users.plan). */
export const PIPELINE_PLANS = ['starter', 'pro'] as const;
/**
 * The single pipeline entitlement rule, shared by the cron sweep and the per-owner check: a paid plan AND either
 *  - no subscription row at all (operator-granted plan, e.g. the in-house account), or
 *  - an active subscription.
 * A billed owner whose subscriptions are all past_due/canceled is blocked even if users.plan still says paid
 * (e.g. a cancel webhook that failed half-way before the transaction fix — codex review 2026-11-06).
 */
export const pipelineEntitlement: Prisma.UserWhereInput = {
  plan: { in: [...PIPELINE_PLANS] },
  OR: [{ subscriptions: { none: {} } }, { subscriptions: { some: { status: 'active' } } }],
};
export async function* pipelineOwners(ownerId?: string) {
  let cursor: string | undefined;
  while (true) {
    const rows = await prisma.setting.findMany({ where: {
      automationDomainId:{ not:null }, ...(ownerId ? { ownerId }:{}),
      owner: pipelineEntitlement,
      ...(cursor ? { id:{ gt:cursor } }:{}),
    },select:{ id:true,ownerId:true,automationDomainId:true },orderBy:{ id:'asc' },take:20 });
    for (const row of rows) yield { ownerId:row.ownerId,domainId:row.automationDomainId! };
    if (rows.length<20 || ownerId) break;
    cursor=rows.at(-1)!.id;
  }
}

export async function pipelineOwnerReason(ownerId:string):Promise<'no_automation_domain'|'plan_limit'|null> {
  const owner=await prisma.user.findFirst({where:{id:ownerId},select:{
    settings:{select:{automationDomainId:true},take:1}}});
  if (!owner?.settings[0]?.automationDomainId) return 'no_automation_domain';
  if (!await prisma.user.findFirst({ where:{ id:ownerId, ...pipelineEntitlement }, select:{ id:true } })) return 'plan_limit';
  return null;
}

export function expectedSkipReason(error: unknown): string | null {
  if (!(error instanceof VisibilityError)) return null;
  return ({ deadline_exceeded:'deadline_hit', data_required:'not_configured', feature_forbidden:'plan_limit', plan_limit:'plan_limit',
    cost_limit:'cost_limit', rate_limited:'cost_limit' } as Record<string,string>)[error.code] ?? null;
}
