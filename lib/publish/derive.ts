import { prisma } from '@/lib/prisma';
import { convertBlogToChannel } from '@/lib/claude/convert';
import { getNaverCafeCreds } from '@/lib/channel-credentials';
import { loadCredentials } from './errors';
import { getUserPlan, checkCostLimit } from '@/lib/billing/limits';
import { createContentRecord } from '@/lib/content/writer';
import { claimPipelineRun, finishPipelineRun } from '@/lib/pipeline/run-claim';
/** 내부 표식: 자격증명 복호화 실패를 skip 사유로 바꾸기 위한 전용 오류(외부로 나가지 않음) */
class CredentialStorageSkip extends Error {}
export async function deriveCafeContent(ownerId: string, parentContentId: string) {
  const existing = await prisma.content.findFirst({ where: { ownerId, parentContentId, channel: 'naver_cafe', origin: 'auto' }, select: { id: true } });
  if (existing) return { status: 'pending_review' as const, childContentId: existing.id, reason: null };
  const skip = (reason: 'no_credentials' | 'cost_limit' | 'credential_storage_error') => ({ status: 'skipped' as const, childContentId: null, reason });
  const parent = await prisma.content.findFirst({ where: { id: parentContentId, ownerId, reviewStatus: 'approved' } });
  if (!parent) return skip('no_credentials');
  // 저장 자격증명 복호화 실패는 발행 어댑터·claim 경로와 같은 확정 실패 — 원본 throw 대신 분류된 skip(사유 코드)
  let creds: Awaited<ReturnType<typeof getNaverCafeCreds>>;
  try { creds = await loadCredentials(() => getNaverCafeCreds(ownerId), 'naver_cafe', () => new CredentialStorageSkip()); }
  catch (error) { if (error instanceof CredentialStorageSkip) return skip('credential_storage_error'); throw error; }
  if (!creds) return skip('no_credentials');
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
