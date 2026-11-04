import { prisma } from '@/lib/prisma';
import { parseConsultingSnapshot, consultingStrategySchema } from '@/schemas/consulting';
import { renderEvidenceTokens, formatEvidenceValue } from '@/lib/consulting/evidence-format';
import { boundStrategyContext } from '@/lib/content/strategy-context';
import type { Candidate } from './candidates';
export type StrategySelection = { reportId: string | null; reason: 'used' | 'no_completed_report' | 'no_content_actions' };
export async function strategyCandidates(ownerId: string, domainId: string | null): Promise<{ candidates: Candidate[]; strategy: StrategySelection }> {
  const empty = (reason: StrategySelection['reason'], reportId: string | null = null) => ({ candidates: [], strategy: { reportId, reason } });
  if (!domainId) return empty('no_completed_report');
  const domain = await prisma.domain.findFirst({ where: { id: domainId, ownerId }, select: { market: true } });
  if (!domain) return empty('no_completed_report');
  const report = await prisma.consultingReport.findFirst({ where: { ownerId, domainId, market: domain.market, status: 'completed' },
    orderBy: [{ generatedAt: 'desc' }, { id: 'asc' }], select: { id: true, priorityActions: true, inputSnapshot: true, schemaVersion: true } });
  if (!report) return empty('no_completed_report');
  const actions = consultingStrategySchema.shape.priorityActions.parse(report.priorityActions).filter(a => a.destination === 'content_create');
  if (!actions.length) return empty('no_content_actions', report.id);
  const snapshot = parseConsultingSnapshot(report.inputSnapshot, report.schemaVersion);
  const evidence = new Map(snapshot.evidence.map(e => [e.id, e]));
  return { strategy: { reportId: report.id, reason: 'used' }, candidates: actions.map(action => ({
    topic: renderEvidenceTokens(action.title, evidence).slice(0,80), signal: 'strategy',
    weight: { P0:10, P1:9, P2:8 }[action.priority],
    strategy: { reportId: report.id, actionId: action.id, priority: action.priority, evidenceIds: action.evidenceIds },
    strategyContext: boundStrategyContext({ v:1, reportId:report.id, actionId:action.id, priority:action.priority,
      actionTitle:renderEvidenceTokens(action.title,evidence), actionDescription:renderEvidenceTokens(action.description,evidence),
      evidence:action.evidenceIds.flatMap(id => { const e=evidence.get(id); return e ? [{ id, label:e.label, value:formatEvidenceValue(e) }] : []; }),
      range:snapshot.range, limitations:snapshot.limitations }),
  })) };
}
