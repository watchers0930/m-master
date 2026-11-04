import { prisma } from '@/lib/prisma';
export type StrategyContext = {
  v: 1; reportId: string; actionId: string; priority: 'P0' | 'P1' | 'P2'; actionTitle: string;
  actionDescription: string; evidence: { id: string; label: string; value: string }[];
  range: { from: string; to: string }; limitations: string[]; truncated?: boolean;
};
export function boundStrategyContext(value: StrategyContext): StrategyContext {
  const result = { ...value, actionTitle: value.actionTitle.slice(0, 80), actionDescription: value.actionDescription.slice(0, 400),
    evidence: value.evidence.slice(0, 10), limitations: value.limitations.slice(0, 5) };
  while (Buffer.byteLength(JSON.stringify(result)) > 4096 && (result.evidence.length || result.limitations.length)) {
    if (result.evidence.length) result.evidence.pop(); else result.limitations.pop();
    result.truncated = true;
  }
  return result;
}
export async function strategyContextForItem(ownerId: string, planItemId: string) {
  const item = await prisma.contentPlanItem.findFirst({ where: { id: planItemId, plan: { ownerId } }, select: { strategyContext: true } });
  if (!item?.strategyContext || typeof item.strategyContext !== 'object' || Array.isArray(item.strategyContext)) return undefined;
  const context = item.strategyContext as unknown as StrategyContext;
  if (!context.reportId) return undefined;
  const report = await prisma.consultingReport.findFirst({ where: { id: context.reportId, ownerId, status: 'completed' }, select: { id: true } });
  if (!report) {
    await prisma.auditLog.create({ data:{ actor:ownerId,action:'content.strategy_context',targetType:'content_plan_item',targetId:planItemId,
      payload:{strategy_context:'rejected_ownership'} } });
    return undefined;
  }
  return boundStrategyContext(context);
}
