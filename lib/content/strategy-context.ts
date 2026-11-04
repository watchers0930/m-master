import { prisma } from '@/lib/prisma';
import { strategyContextSchema, type StrategyContext } from '@/schemas/strategy-context';
import { stripUnsafeControls, delimiterSafeJson } from '@/lib/utils/untrusted-text';
export type { StrategyContext } from '@/schemas/strategy-context';
export function boundStrategyContext(value: StrategyContext): StrategyContext {
  const result = { ...value, actionTitle: value.actionTitle.slice(0, 80), actionDescription: value.actionDescription.slice(0, 400),
    evidence: value.evidence.slice(0, 10), limitations: value.limitations.slice(0, 5) };
  while (Buffer.byteLength(JSON.stringify(result)) > 4096 && (result.evidence.length || result.limitations.length)) {
    if (result.evidence.length) result.evidence.pop(); else result.limitations.pop();
    result.truncated = true;
  }
  return result;
}
/**
 * The single place untrusted strategy text enters a generation prompt (L26/L17): every string is stripped of
 * C0/C1/bidi/invisible controls and the JSON carries no raw `<`/`>`, so `</untrusted_strategy>` cannot close the block.
 */
export function strategyPromptBlock(context: StrategyContext): string {
  const clean = (value: unknown): unknown => typeof value === 'string' ? stripUnsafeControls(value)
    : Array.isArray(value) ? value.map(clean)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v)])) : value;
  return '<untrusted_strategy>' + delimiterSafeJson(clean(context)) + '</untrusted_strategy>';
}
/** Stored JSON is validated, never cast; invalid/foreign contexts degrade to "no strategy" with a logged code. */
export async function strategyContextForItem(ownerId: string, planItemId: string): Promise<StrategyContext | undefined> {
  const item = await prisma.contentPlanItem.findFirst({ where: { id: planItemId, plan: { ownerId } }, select: { strategyContext: true } });
  if (item?.strategyContext == null) return undefined;
  const parsed = strategyContextSchema.safeParse(item.strategyContext);
  const reject = async (reason: 'invalid_schema' | 'rejected_ownership') => {
    await prisma.auditLog.create({ data:{ actor:ownerId,action:'content.strategy_context',targetType:'content_plan_item',targetId:planItemId,
      payload:{strategy_context:reason} } });
    return undefined;
  };
  if (!parsed.success) { console.warn('[strategy-context] stored context rejected', { code: 'invalid_schema' }); return reject('invalid_schema'); }
  const report = await prisma.consultingReport.findFirst({ where: { id: parsed.data.reportId, ownerId, status: 'completed' }, select: { id: true } });
  if (!report) return reject('rejected_ownership');
  return boundStrategyContext(parsed.data);
}
