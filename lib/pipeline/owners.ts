import { VisibilityError } from '@/lib/visibility/errors';
import { prisma } from '@/lib/prisma';
export async function* pipelineOwners(ownerId?: string) {
  let cursor: string | undefined;
  while (true) {
    const rows = await prisma.setting.findMany({ where: {
      automationDomainId:{ not:null }, ...(ownerId ? { ownerId }:{}),
      owner:{ plan:{ in:['starter','pro'] },subscriptions:{ some:{ status:'active' } } },
      ...(cursor ? { id:{ gt:cursor } }:{}),
    },select:{ id:true,ownerId:true,automationDomainId:true },orderBy:{ id:'asc' },take:20 });
    for (const row of rows) yield { ownerId:row.ownerId,domainId:row.automationDomainId! };
    if (rows.length<20 || ownerId) break;
    cursor=rows.at(-1)!.id;
  }
}

export async function pipelineOwnerReason(ownerId:string):Promise<'no_automation_domain'|'plan_limit'|null> {
  const owner=await prisma.user.findFirst({where:{id:ownerId},select:{plan:true,
    settings:{select:{automationDomainId:true},take:1},subscriptions:{where:{status:'active'},select:{id:true},take:1}}});
  if (!owner?.settings[0]?.automationDomainId) return 'no_automation_domain';
  if (!['starter','pro'].includes(owner.plan) || !owner.subscriptions.length) return 'plan_limit';
  return null;
}

export function expectedSkipReason(error: unknown): string | null {
  if (!(error instanceof VisibilityError)) return null;
  return ({ deadline_exceeded:'deadline_hit', data_required:'not_configured', feature_forbidden:'plan_limit', plan_limit:'plan_limit',
    cost_limit:'cost_limit', rate_limited:'cost_limit' } as Record<string,string>)[error.code] ?? null;
}
