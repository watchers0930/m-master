import { Prisma, type TopicRecommendation } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getUserPlan, checkCostLimit } from '@/lib/billing/limits';
import { notFound, VisibilityError } from '@/lib/visibility/http';
import { resolveGa4Scope } from '@/lib/ga4/scope';
import { fetchPopularPages } from '@/lib/ga4/popular';
import type { Ga4Block } from '@/types/ga4';
import { toGa4Block } from '@/lib/ga4/block';
import { claimPipelineRun, finishPipelineRun } from '@/lib/pipeline/run-claim';
import { calcChatKrw } from '@/lib/claude/chat';
import { buildCandidates, type Candidate, type BusinessContext } from './candidates';
import { recommendTopFive } from './recommend';
import { visibilityGapCandidates } from './visibility-gap';
import { strategyCandidates, type StrategySelection } from './strategy-candidates';
import { persistTopics } from './persist';
export type TopicRefreshInput = { ownerId: string; domainId: string | null; weekStart: string; mode: 'auto' | 'regenerate'; channel: 'blog' };
export type TopicRefreshResult = { status: 'created' | 'reused' | 'in_progress' | 'insufficient'; items: TopicRecommendation[];
  count: number; shortfallReason: 'not_enough_candidates' | null; strategy: StrategySelection;
  ga4Status: Ga4Block<unknown>['state']; costKrw: number };
export function orderTopics(items: TopicRecommendation[]) {
  const factor = (row: TopicRecommendation) => row.factors as { strategy?: { priority: 'P0'|'P1'|'P2' }; candidateId?: string } | null;
  const priority = (row: TopicRecommendation) => { const p = factor(row)?.strategy?.priority; return p ? { P0:0,P1:1,P2:2 }[p] : 3; };
  return items.sort((a,b) => priority(a)-priority(b) || b.score-a.score || Number(factor(a)?.candidateId?.slice(1) ?? 0)-Number(factor(b)?.candidateId?.slice(1) ?? 0));
}
export async function refreshTopics(input: TopicRefreshInput): Promise<TopicRefreshResult> {
  const { ownerId, weekStart, mode } = input;
  const setting = await prisma.setting.findUnique({ where: { ownerId }, select: { automationDomainId:true, brandGuide:true } });
  const domainId = input.domainId ?? setting?.automationDomainId ?? null;
  if (domainId && !await prisma.domain.findFirst({ where: { id:domainId, ownerId }, select: { id:true } })) notFound();
  try { await checkCostLimit(ownerId, await getUserPlan(ownerId)); }
  catch { throw new VisibilityError('plan_limit', '비용 한도를 확인하세요.', 403); }
  const run = await claimPipelineRun({ kind:'topics', ownerId, scopeKey:`${domainId ?? 'none'}:blog`, periodKey:weekStart }, mode === 'regenerate');
  if (!run.acquired) {
    const metadata = run.resultRef as { strategy?: StrategySelection; ga4Status?: Ga4Block<unknown>['state']; items?: TopicRecommendation[] } | null;
    const items = run.status === 'succeeded' ? orderTopics(metadata?.items?.map(item=>({...item,createdAt:new Date(item.createdAt)})) ?? await prisma.topicRecommendation.findMany({ where: { ownerId, weekStart, channel:'blog',factors:{path:['domainId'],equals:domainId === null ? Prisma.JsonNull : domainId} }, take:7 })) : [];
    return { status:run.status === 'succeeded' ? 'reused':run.status === 'skipped' ? 'insufficient':'in_progress', items, count:items.length,
      shortfallReason:items.length < 7 ? 'not_enough_candidates':null,
      strategy: metadata?.strategy ?? { reportId:null, reason:'no_completed_report' }, ga4Status:metadata?.ga4Status ?? 'not_configured', costKrw:0 };
  }
  let billingUncertain = false;
  try {
    const [strategic, scope, gaps, contents] = await Promise.all([
      strategyCandidates(ownerId,domainId), resolveGa4Scope(ownerId,domainId ?? undefined),
      visibilityGapCandidates(ownerId), prisma.content.findMany({ where: { ownerId }, select: { topic:true }, orderBy: { createdAt:'desc' }, take:200 }),
    ]);
    const ga4 = scope.ok ? await fetchPopularPages(30,scope.scope) : { status:'unavailable' as const, reason:scope.reason };
    const bg = (setting?.brandGuide ?? {}) as Record<string,unknown>;
    const businessContext: BusinessContext = {
      industry:typeof bg.industry === 'string' ? bg.industry:undefined,
      coreKeywords:Array.isArray(bg.core_keywords) ? bg.core_keywords.filter((v):v is string => typeof v==='string'):undefined,
      services:Array.isArray(bg.services) ? bg.services.filter((v):v is string => typeof v==='string'):undefined,
      companyName:typeof bg.company_name === 'string' ? bg.company_name:undefined,
    };
    const monthYmd=weekStart.slice(0,7)+'-01';
    const candidates: Candidate[] = [], titles=new Set<string>();
    for (const candidate of [...strategic.candidates, ...buildCandidates({ monthYmd, publishedTopics:contents.map(c=>c.topic),
      visibilityGaps:gaps, ga4PopularPaths:ga4.status==='success' ? ga4.data:undefined, businessContext })]) {
      const normalized=candidate.topic.replace(/\s/g,'').toLowerCase();
      if (titles.has(normalized)) continue;
      titles.add(normalized); candidates.push({ ...candidate, candidateId:`c${candidates.length}` });
      if (candidates.length===20) break;
    }
    if (!candidates.length) {
      await finishPipelineRun(run,'skipped',{ count:0,strategyReportId:strategic.strategy.reportId,strategy:strategic.strategy,ga4Status:toGa4Block(ga4).state });
      return { status:'insufficient',items:[],count:0,shortfallReason:'not_enough_candidates',strategy:strategic.strategy,ga4Status:toGa4Block(ga4).state,costKrw:0 };
    }
    billingUncertain = true;
    const recommended = await recommendTopFive({ monthYmd,candidates,channel:'blog',businessContext,
      onUsage: async usage => {
        await prisma.costLedger.create({ data: { ownerId, kind:'chat', krw:calcChatKrw(usage),
          tokensIn:usage.prompt_tokens, tokensOut:usage.completion_tokens } });
        billingUncertain = false;
      },
    });
    const costKrw=calcChatKrw(recommended.usage), ga4Status=toGa4Block(ga4).state;
    const rows = recommended.items.slice(0,7).map(item => {
      const c=candidates[(item.candidateIndex ?? 0)-1];
      if (!c) throw new Error('invalid_candidate_index');
      return { ownerId,weekStart,channel:'blog',topic:c.topic,score:item.score,
        factors:{ v:2,signal:c.signal,candidateId:c.candidateId!,domainId,recommendRank:item.recommendRank ?? null,
          tags:item.tags,reason:item.reason,...(c.strategy ? { strategy:c.strategy }:{}),
          ...(c.factors ? { visibility:c.factors }:{}),
        } as unknown as Prisma.InputJsonValue };
    });
    const items = orderTopics(await persistTopics({ ownerId,domainId,weekStart,rows,run,mode,
      metadata:{ strategy:strategic.strategy,ga4Status,strategyReportId:strategic.strategy.reportId } }));
    return { status:items.length ? 'created':'insufficient',items,count:items.length,
      shortfallReason:items.length<7 ? 'not_enough_candidates':null,strategy:strategic.strategy,ga4Status,costKrw };
  } catch (error) {
    await finishPipelineRun(run,billingUncertain ? 'skipped' : 'failed',undefined,billingUncertain ? 'billing_uncertain' : 'recommend_failed');
    if (error instanceof VisibilityError) throw error;
    throw new VisibilityError('recommend_failed','추천 생성에 실패했습니다.',500);
  }
}
