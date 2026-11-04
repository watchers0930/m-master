import { prisma } from '@/lib/prisma';
import { toSnakeCase } from '@/lib/utils/case';
import { notFound, VisibilityError } from '@/lib/visibility/http';
import { requireGa4Data } from '@/lib/ga4/api';
import { resolveGa4UrlScope } from '@/lib/ga4/scope';
import { fetchMultiplePathMetrics } from '@/lib/ga4/path-metrics';
import { buildCompletionFromGa4, computeMeasurePeriod, isMeasureWindowElapsed } from './state';
import type { AbTest } from '@/types/db';
export async function abTestGa4(ownerId: string, id: string) {
  const row = await prisma.abTest.findFirst({ where: { id, ownerId } });
  if (!row) notFound();
  const test = toSnakeCase(row) as unknown as AbTest;
  if (test.status === 'draft' || !test.variant_a_path || !test.variant_b_path || !test.started_at)
    throw new VisibilityError('invalid_state', '측정을 시작한 테스트가 필요합니다.', 409);
  if (test.status === 'completed' && test.ga4_snapshot) return {
    variant_a: test.ga4_snapshot.variant_a, variant_b: test.ga4_snapshot.variant_b,
    period: test.ga4_snapshot.period, auto_completed: false, snapshot: test.ga4_snapshot,
  };
  if (test.status === 'running' && isMeasureWindowElapsed(test)) {
    const result = await buildCompletionFromGa4(ownerId, test);
    const changed = await prisma.$transaction(async tx => {
      const changed = await tx.abTest.updateMany({ where: { id, ownerId, updatedAt: row.updatedAt, status: 'running' }, data: {
        status: 'completed', completedAt: new Date(), winner: result.winner, winnerDecidedBy: 'auto',
        ga4Snapshot: JSON.parse(JSON.stringify(result.ga4Snapshot)),
      } });
      if (changed.count) await tx.auditLog.create({ data: { actor: ownerId, action: 'ab_test.auto_complete',
        targetType: 'ab_test', targetId: id } });
      return changed.count;
    });
    return { variant_a: result.ga4Snapshot.variant_a, variant_b: result.ga4Snapshot.variant_b,
      period: result.ga4Snapshot.period, auto_completed: !!changed, snapshot: result.ga4Snapshot };
  }
  const scope = await resolveGa4UrlScope(ownerId, [test.variant_a_url, test.variant_b_url]);
  if (!scope.ok) requireGa4Data({ status: 'unavailable', reason: scope.reason });
  const { from, to } = computeMeasurePeriod(test);
  const data = requireGa4Data(await fetchMultiplePathMetrics([test.variant_a_path, test.variant_b_path], from, to, scope.ok ? scope.scope : undefined));
  return { variant_a: data[test.variant_a_path], variant_b: data[test.variant_b_path],
    period: { from: from.toISOString(), to: to.toISOString() }, auto_completed: false, snapshot: null };
}
