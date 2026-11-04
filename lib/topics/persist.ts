import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { RunClaim } from '@/lib/pipeline/run-claim';
export async function persistTopics(input: {
  ownerId: string; domainId: string | null; weekStart: string; rows: Prisma.TopicRecommendationCreateManyInput[];
  run: RunClaim; mode: 'auto' | 'regenerate'; metadata: Prisma.InputJsonObject;
}) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM users WHERE id=${input.ownerId} FOR UPDATE`;
    const changed = await tx.pipelineRun.updateMany({ where: { id: input.run.id, attempts: input.run.attempts, status: 'running' }, data: {
      status: 'succeeded', finishedAt: new Date(), resultRef: { ...input.metadata, count: input.rows.length },
    } });
    if (!changed.count) throw new Error('pipeline_lease_lost');
    await tx.topicRecommendation.deleteMany({ where: { ownerId: input.ownerId, weekStart: input.weekStart, channel: 'blog', factors: { path: ['domainId'], equals: input.domainId === null ? Prisma.JsonNull : input.domainId } } });
    await tx.topicRecommendation.createMany({ data: input.rows });
    await tx.auditLog.create({ data: { actor: input.mode === 'auto' ? null : input.ownerId,
      action: input.mode === 'auto' ? 'cron.topics_refresh' : 'topics.refresh',
      targetType: 'topic_recommendations', targetId: input.weekStart, payload: { ...input.metadata, count: input.rows.length } } });
    const items = await tx.topicRecommendation.findMany({ where: { ownerId: input.ownerId, weekStart: input.weekStart, channel: 'blog', factors: { path: ['domainId'], equals: input.domainId === null ? Prisma.JsonNull : input.domainId } }, take: 7, orderBy: [{ score:'desc' },{ id:'asc' }] });
    await tx.pipelineRun.updateMany({ where:{ id:input.run.id,attempts:input.run.attempts,status:'succeeded' },data:{ resultRef:{
      ...input.metadata,count:items.length,items:JSON.parse(JSON.stringify(items)),
    } } });
    return items;
  });
}
