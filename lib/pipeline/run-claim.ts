import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
type Key = { kind: string; ownerId: string; scopeKey: string; periodKey: string };
export type RunClaim = { acquired: boolean; id: string; attempts: number; status: string; errorCode?: string | null; resultRef: Prisma.JsonValue | null };
export async function claimPipelineRun(key: Key, regenerate = false): Promise<RunClaim> {
  return prisma.$transaction(async tx => {
    const now = new Date(), leaseUntil = new Date(Date.now() + 6 * 60000);
    const inserted = await tx.pipelineRun.createMany({ data: { ...key, leaseUntil }, skipDuplicates: true });
    await tx.$queryRaw`SELECT id FROM pipeline_runs WHERE kind=${key.kind} AND owner_id=${key.ownerId}
      AND scope_key=${key.scopeKey} AND period_key=${key.periodKey} FOR UPDATE`;
    const row = await tx.pipelineRun.findUniqueOrThrow({ where: { kind_ownerId_scopeKey_periodKey: key } });
    if (inserted.count) return { ...row, acquired: true };
    if (row.status === 'running' && row.leaseUntil > now) return { ...row, acquired: false };
    if (row.status === 'succeeded' && !regenerate) return { ...row, acquired: false };
    if (row.status === 'skipped' && !regenerate) return { ...row, acquired: false };
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
