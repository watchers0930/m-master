import { prisma } from '@/lib/prisma';
import { generateReport } from '@/lib/consulting/generate';
import { getMondayOfWeekKST } from '@/lib/topics/week-utils';
import { claimPipelineRun, finishPipelineRun } from './run-claim';
import { pipelineOwners,pipelineOwnerReason,expectedSkipReason } from './owners';
/** Monday 00:00 KST of `weekStart` as an instant. */
export function weekStartInstant(weekStart: string) { return new Date(`${weekStart}T00:00:00+09:00`); }
/**
 * Resumable per ISO week (KST Monday). One invocation fits only ~1–2 owners (generateReport needs 210s
 * headroom), so the cron repeats it (see ./schedule.ts); every repeat skips owners already done this week:
 *  - a succeeded `strategy` run for the week → reused (no LLM call);
 *  - a completed consulting report generated since Monday (e.g. manual) → recorded as succeeded, reused;
 *  - `deadline_hit` is recorded as a resumable skip (run-claim RESUMABLE_SKIPS), never as a failure.
 */
export async function refreshWeeklyStrategies(ownerId?: string, deadline=Date.now()+240000) {
  const result={ ok:true,processed:0,reused:0,skipped:[] as { owner_id:string;reason:string }[],failed:0,deadline_hit:false };
  if (ownerId) { const reason=await pipelineOwnerReason(ownerId);if(reason) {result.skipped.push({owner_id:ownerId,reason});return result;} }
  const weekStart=getMondayOfWeekKST(), since=weekStartInstant(weekStart);
  for await (const owner of pipelineOwners(ownerId)) {
    if (Date.now()+210000>=deadline) { result.deadline_hit=true;break; }
    const run=await claimPipelineRun({ kind:'strategy',ownerId:owner.ownerId,scopeKey:owner.domainId,periodKey:weekStart });
    if (!run.acquired) {
      if (run.status==='succeeded') result.reused++;
      else result.skipped.push({ owner_id:owner.ownerId,reason:run.status==='skipped' ? run.errorCode ?? 'not_configured' : run.status==='failed' ? 'retry_exhausted' : 'in_progress' });
      continue;
    }
    try {
      const existing=await prisma.consultingReport.findFirst({ where:{ ownerId:owner.ownerId,domainId:owner.domainId,status:'completed',generatedAt:{ gte:since } },
        orderBy:[{ generatedAt:'desc' },{ id:'asc' }],select:{ id:true } });
      if (existing) { await finishPipelineRun(run,'succeeded',{ reportId:existing.id,reused:true });result.reused++;continue; }
      const report=await generateReport(owner.ownerId,{ domainId:owner.domainId },deadline);
      await finishPipelineRun(run,'succeeded',{ reportId:report.data.id });
      result.processed++;
    } catch (error) {
      const reason = expectedSkipReason(error);
      if (reason === 'deadline_hit') result.deadline_hit = true;
      await finishPipelineRun(run,reason ? 'skipped' : 'failed',undefined,reason ?? 'strategy_failed');
      if (reason) result.skipped.push({ owner_id:owner.ownerId,reason });
      else result.failed++;
    }
  }
  return result;
}
