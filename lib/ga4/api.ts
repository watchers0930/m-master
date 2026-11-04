import { notFound, VisibilityError } from '@/lib/visibility/http';
import type { Ga4Result, Ga4Scope } from '@/types/ga4';
import { toGa4Block } from './block';
import { resolveGa4Scope, type ScopeResult } from './scope';
export async function apiGa4Scope(ownerId: string, domainId?: string) {
  const result = await resolveGa4Scope(ownerId, domainId);
  if (domainId && !result.ok && result.reason === 'unmapped') {
    // Missing binding is a block; missing/foreign domain is a 404.
    const { prisma } = await import('@/lib/prisma');
    if (!await prisma.domain.findFirst({ where: { id: domainId, ownerId }, select: { id: true } })) notFound();
  }
  return result;
}
export async function scopedBlock<T>(resolved: ScopeResult, query: (scope: Ga4Scope) => Promise<Ga4Result<T>>) {
  return toGa4Block(resolved.ok ? await query(resolved.scope) : { status: 'unavailable', reason: resolved.reason });
}
export function requireGa4Data<T>(result: Ga4Result<T>): T {
  if (result.status === 'success') return result.data;
  if (result.status === 'error') throw Object.assign(new VisibilityError('ga4_error', 'GA4 조회에 실패했습니다.', 502), { details: { ga4_code: result.code } });
  throw Object.assign(new VisibilityError('ga4_unavailable', 'GA4 연결 상태를 확인하세요.', 409), { details: { reason: result.reason } });
}
