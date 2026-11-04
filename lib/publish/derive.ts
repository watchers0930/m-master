import { prisma } from '@/lib/prisma';
import { convertBlogToChannel } from '@/lib/claude/convert';
import { getNaverCafeCreds } from '@/lib/channel-credentials';
import { getUserPlan, checkCostLimit } from '@/lib/billing/limits';
import { createContentRecord } from '@/lib/content/writer';
import { claimPipelineRun, finishPipelineRun } from '@/lib/pipeline/run-claim';
export async function deriveCafeContent(ownerId: string, parentContentId: string) {
  const existing = await prisma.content.findFirst({ where: { ownerId, parentContentId, channel: 'naver_cafe', origin: 'auto' }, select: { id: true } });
  if (existing) return { status: 'pending_review' as const, childContentId: existing.id, reason: null };
  const skip = (reason: 'no_credentials' | 'cost_limit') => ({ status: 'skipped' as const, childContentId: null, reason });
  const parent = await prisma.content.findFirst({ where: { id: parentContentId, ownerId, reviewStatus: 'approved' } });
  if (!parent || !await getNaverCafeCreds(ownerId)) return skip('no_credentials');
  try { await checkCostLimit(ownerId, await getUserPlan(ownerId)); } catch { return skip('cost_limit'); }
  const run = await claimPipelineRun({ kind: 'derive', ownerId, scopeKey: parentContentId, periodKey: 'naver_cafe' });
  if (!run.acquired) return skip('no_credentials');
  try {
    const converted = await convertBlogToChannel(parent.textBody ?? '', parent.topic, 'naver_cafe');
    const child = await prisma.$transaction(async tx => {
      const child = await createContentRecord(tx, { origin: 'auto', ownerId, parentContentId, channel: 'naver_cafe',
        topic: converted.seoTitle ?? parent.topic, keywords: converted.seoTags ?? parent.keywords,
        textBody: converted.text, imageUrl: parent.imageUrl, bodyImageUrls: parent.bodyImageUrls, costKrw: converted.krw,
        strategyContext: parent.strategyContext ?? undefined });
      await tx.costLedger.create({ data: { ownerId, kind: 'chat', krw: converted.krw,
        tokensIn: converted.usage.prompt_tokens, tokensOut: converted.usage.completion_tokens, contentId: child.id } });
      return child;
    });
    await finishPipelineRun(run, 'succeeded', { contentId: child.id });
    return { status: 'pending_review' as const, childContentId: child.id, reason: null };
  } catch (error) {
    await finishPipelineRun(run, 'failed', undefined, 'derive_failed');
    throw error;
  }
}
