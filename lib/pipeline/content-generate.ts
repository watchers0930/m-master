import { prisma } from '@/lib/prisma';
import { getTodayKST } from '@/lib/cron/auth';
import { generateContentHeadless } from '@/lib/content/generate-headless';
import { strategyContextForItem } from '@/lib/content/strategy-context';
import { getUserPlan,checkContentLimit,checkCostLimit } from '@/lib/billing/limits';
import { pipelineOwners } from './owners';
import { ensureWeeklyPlan } from './weekly-plan';
import { claimPipelineRun,finishPipelineRun } from './run-claim';
export async function generateDailyContent(deadline=Date.now()+240000) {
  const result={ ok:true,generated:0,skipped:[] as { owner_id:string;reason:string }[],failed:0,deadline_hit:false };
  const today=getTodayKST();
  for await (const owner of pipelineOwners()) {
    if (Date.now()+100000>=deadline) { result.deadline_hit=true;break; }
    try {
      await ensureWeeklyPlan(owner.ownerId,owner.domainId);
      const items=await prisma.contentPlanItem.findMany({ where:{ scheduledDate:today,status:{ in:['planned','generating','failed'] },
        contentJobId:null,plan:{ ownerId:owner.ownerId,status:'active',autoGenerate:true } },select:{ id:true,topic:true },orderBy:{ sortOrder:'asc' },take:7 });
      for (const item of items) {
        if (Date.now()+100000>=deadline) { result.deadline_hit=true;break; }
        const plan=await getUserPlan(owner.ownerId);
        try { await checkCostLimit(owner.ownerId,plan); await checkContentLimit(owner.ownerId,plan); }
        catch { result.skipped.push({ owner_id:owner.ownerId,reason:'plan_limit' });break; }
        const run=await claimPipelineRun({ kind:'content_item',ownerId:owner.ownerId,scopeKey:item.id,periodKey:today });
        if (!run.acquired) { result.skipped.push({ owner_id:owner.ownerId,reason:run.status==='succeeded'?'already_succeeded':'in_progress' });continue; }
        const changed=await prisma.contentPlanItem.updateMany({ where:{ id:item.id,plan:{ ownerId:owner.ownerId },contentJobId:null,
          status:{ in:['planned','generating','failed'] } },data:{ status:'generating' } });
        if (!changed.count) { await finishPipelineRun(run,'skipped');continue; }
        try {
          const generated=await generateContentHeadless({ ownerId:owner.ownerId,mode:'auto',topic:item.topic,channel:'blog',
            pipelineClaim:{id:run.id,attempts:run.attempts,planItemId:item.id},strategyContext:await strategyContextForItem(owner.ownerId,item.id) });
          result.generated++;
        } catch {
          await prisma.contentPlanItem.updateMany({ where:{ id:item.id,plan:{ ownerId:owner.ownerId },contentJobId:null },data:{ status:'failed' } });
          await finishPipelineRun(run,'failed',undefined,'generate_failed');result.failed++;
        }
      }
    } catch { result.failed++; }
  }
  return result;
}
