import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
type Key = { kind: string; ownerId: string; scopeKey: string; periodKey: string };
export const RESUMABLE_SKIPS = new Set(['deadline_hit']);
export type RunClaim = { acquired: boolean; id: string; attempts: number; status: string; errorCode?: string | null; resultRef: Prisma.JsonValue | null };
/**
 * Automatic re-claims stop at this many attempts per period (repeated crons must not loop on paid calls).
 * Applies to `failed` rows and to expired `running` rows (platform timeout after a paid call, before persist):
 * every re-claim increments `attempts`, so both paths share one cap.
 */
export const MAX_AUTO_ATTEMPTS = 4;
export async function claimPipelineRun(key: Key, regenerate = false, maxAttempts = MAX_AUTO_ATTEMPTS): Promise<RunClaim> {
  return prisma.$transaction(async tx => {
    const now = new Date(), leaseUntil = new Date(Date.now() + 6 * 60000);
    const inserted = await tx.pipelineRun.createMany({ data: { ...key, leaseUntil }, skipDuplicates: true });
    await tx.$queryRaw`SELECT id FROM pipeline_runs WHERE kind=${key.kind} AND owner_id=${key.ownerId}
      AND scope_key=${key.scopeKey} AND period_key=${key.periodKey} FOR UPDATE`;
    const row = await tx.pipelineRun.findUniqueOrThrow({ where: { kind_ownerId_scopeKey_periodKey: key } });
    if (inserted.count) return { ...row, acquired: true };
    if (row.status === 'running' && row.leaseUntil > now) return { ...row, acquired: false };
    if (row.status === 'succeeded' && !regenerate) return { ...row, acquired: false };
    if (row.status === 'failed' && !regenerate && row.attempts >= maxAttempts) return { ...row, acquired: false };
    if (row.status === 'running' && !regenerate && row.attempts >= maxAttempts) {
      // 만료된 running이 상한에 닿음 → 더 이상 자동 재시도하지 않고 failed로 확정(관측 가능하게 사유 기록).
      await tx.pipelineRun.updateMany({ where: { id: row.id, attempts: row.attempts, status: 'running' }, data: {
        status: 'failed', errorCode: 'lease_expired', finishedAt: now } });
      return { ...row, status: 'failed', errorCode: 'lease_expired', acquired: false };
    }
    // `deadline_hit` is a deferral, not a verdict: the next invocation may resume it (M10/N2).
    if (row.status === 'skipped' && !regenerate && !RESUMABLE_SKIPS.has(row.errorCode ?? '')) return { ...row, acquired: false };
    const claimed = await tx.pipelineRun.updateMany({ where: { id: row.id, attempts: row.attempts }, data: {
      status: 'running', attempts: { increment: 1 }, leaseUntil, startedAt: now, finishedAt: null, errorCode: null,
    } });
    return { acquired: claimed.count === 1, id: row.id, attempts: row.attempts + 1, status: 'running', resultRef: row.resultRef };
  });
}
export async function finishPipelineRun(run: Pick<RunClaim, 'id' | 'attempts'>, status: 'succeeded' | 'failed' | 'skipped', resultRef?: Prisma.InputJsonValue, errorCode?: string) {
  await prisma.pipelineRun.updateMany({ where: { id: run.id, attempts: run.attempts, status: 'running' }, data: {
    status, resultRef, errorCode, finishedAt: new Date(),
  } });
}
