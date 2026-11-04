import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { refreshTopics, orderTopics } from '@/lib/topics/service';
import { strategyCandidates } from '@/lib/topics/strategy-candidates';
import { getMondayOfWeekKST, getWeekdayDates } from '@/lib/topics/week-utils';
import { claimPipelineRun, finishPipelineRun } from './run-claim';
import { pipelineOwners,pipelineOwnerReason,expectedSkipReason } from './owners';
export async function ensureWeeklyPlan(ownerId: string, domainId: string) {
  const weekStart=getMondayOfWeekKST();
  const existing=await prisma.contentPlan.findUnique({ where:{ ownerId_weekKey:{ ownerId,weekKey:weekStart } },select:{ id:true } });
  if (existing) return { reused:true,planId:existing.id };
  const refreshed=await refreshTopics({ ownerId,domainId,weekStart,mode:'auto',channel:'blog' });
  if (refreshed.status==='in_progress') return { reason:'in_progress' };
  if (!refreshed.items.length) return { reason:'not_enough_candidates' };
  const run=await claimPipelineRun({ kind:'plan',ownerId,scopeKey:domainId,periodKey:weekStart });
  if (!run.acquired) return { reason:'in_progress' };
  try {
    const strategy=await strategyCandidates(ownerId,domainId), dates=getWeekdayDates(weekStart);
    const contexts=new Map(strategy.candidates.map(c=>[c.strategy?.actionId,c.strategyContext]));
    const topics=orderTopics(refreshed.items);
    const plan=await prisma.contentPlan.upsert({ where:{ ownerId_weekKey:{ ownerId,weekKey:weekStart } },update:{},create:{
      ownerId,weekKey:weekStart,items:{ create:topics.map((topic,index)=>{
        const factors=topic.factors as { strategy?:{ reportId:string;actionId:string } } | null;
        const context=contexts.get(factors?.strategy?.actionId);
        return { topic:topic.topic,sortOrder:index,scheduledDate:dates[index],topicRecommendationId:topic.id,
          strategyContext:context && context.reportId===factors?.strategy?.reportId ? context as unknown as Prisma.InputJsonValue:undefined };
      }) },
    },select:{ id:true } });
    await finishPipelineRun(run,'succeeded',{ planId:plan.id });
    return { reused:refreshed.status==='reused',planId:plan.id };
  } catch(error) { await finishPipelineRun(run,'failed',undefined,'plan_failed');throw error; }
}
export async function refreshWeeklyPlans(ownerId?: string,deadline=Date.now()+240000) {
  const result={ ok:true,processed:0,reused:0,skipped:[] as { owner_id:string;reason:string }[],failed:0,deadline_hit:false };
  if (ownerId) { const reason=await pipelineOwnerReason(ownerId);if(reason) {result.skipped.push({owner_id:ownerId,reason});return result;} }
  for await (const owner of pipelineOwners(ownerId)) {
    if (Date.now()+65000>=deadline) { result.deadline_hit=true;break; }
    try {
      const plan=await ensureWeeklyPlan(owner.ownerId,owner.domainId);
      if (plan.reason) result.skipped.push({ owner_id:owner.ownerId,reason:plan.reason });
      else if (plan.reused) result.reused++; else result.processed++;
    } catch (error) {
      const reason = expectedSkipReason(error);
      if (reason) result.skipped.push({ owner_id:owner.ownerId,reason });
      else result.failed++;
    }
  }
  return result;
}
