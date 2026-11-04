import { generateReport } from '@/lib/consulting/generate';
import { getMondayOfWeekKST } from '@/lib/topics/week-utils';
import { claimPipelineRun, finishPipelineRun } from './run-claim';
import { pipelineOwners,pipelineOwnerReason,expectedSkipReason } from './owners';
export async function refreshWeeklyStrategies(ownerId?: string, deadline=Date.now()+240000) {
  const result={ ok:true,processed:0,reused:0,skipped:[] as { owner_id:string;reason:string }[],failed:0,deadline_hit:false };
  if (ownerId) { const reason=await pipelineOwnerReason(ownerId);if(reason) {result.skipped.push({owner_id:ownerId,reason});return result;} }
  for await (const owner of pipelineOwners(ownerId)) {
    if (Date.now()+210000>=deadline) { result.deadline_hit=true;break; }
    const run=await claimPipelineRun({ kind:'strategy',ownerId:owner.ownerId,scopeKey:owner.domainId,periodKey:getMondayOfWeekKST() });
    if (!run.acquired) {
      if (run.status==='succeeded') result.reused++;
      else result.skipped.push({ owner_id:owner.ownerId,reason:run.status==='skipped' ? run.errorCode ?? 'not_configured' : 'in_progress' });
      continue;
    }
    try {
      const report=await generateReport(owner.ownerId,{ domainId:owner.domainId },deadline);
      await finishPipelineRun(run,'succeeded',{ reportId:report.data.id });
      result.processed++;
    } catch (error) {
      const reason = expectedSkipReason(error);
      if (reason === 'deadline_hit') result.deadline_hit = true;
      await finishPipelineRun(run,reason && reason !== 'deadline_hit' ? 'skipped' : 'failed',undefined,reason ?? 'strategy_failed');
      if (reason) result.skipped.push({ owner_id:owner.ownerId,reason });
      else result.failed++;
    }
  }
  return result;
}
