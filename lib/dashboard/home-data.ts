// lib/dashboard/home-data.ts
// 홈 대시보드 서버 데이터 로딩 (home/page.tsx 에서 분리 — 페이지는 렌더만).
// GA4 범위: 로그인 소유자의 바인딩만 (설계 §2.3). 미연결·미매핑·도메인 미선택은 블록 상태로 — 0 표시 금지(§2.4).
// 최근 콘텐츠 지표는 발행 URL host 가 GA4 scope.host 와 정확히 같을 때만 조회·매핑한다(다른 사이트 지표 혼입 차단).
import { prisma } from '@/lib/prisma';
import { normalizeGa4Host } from '@/lib/ga4/host';
import { getMonthlySpendKrw } from '@/lib/cost/tracker';
import { fetchMonthlyVisitorsPair, fetchMultiplePathMetrics, type PathMetrics } from '@/lib/ga4/visitors';
import { fetchAvgScorePair, fetchUpcomingMonthScheduleCount, fetchRecentContentPaths } from '@/lib/dashboard/dashboard-stats';
import { nextMonthInfo } from '@/lib/dashboard/grades';
import { kstNow } from '@/lib/ga4/_internal';
import { resolveGa4Scope } from '@/lib/ga4/scope';
import { getMondayOfWeekKST } from '@/lib/topics/week-utils';
import { isEntityId } from '@/schemas/id';
import { toGa4Block, type Ga4Block, type Ga4UnavailableReason } from '@/types/ga4';

interface TopicFactors {
  tags?: { label: string; type: 's' | 'e' | 't' }[];
  reason?: string;
  ga4_unavailable?: boolean;
}

export interface HomeRecentItem {
  id: string;
  topic: string;
  channel: string;
  createdAt: Date;
  scoreAvg: number | null;
  /** 발행 URL 경로. null = 발행 URL 없음 */
  path: string | null;
  /** 발행 URL host 가 현재 GA4 범위(host)와 다름 → 지표를 붙이지 않는다 */
  otherHost: boolean;
}

export interface HomeData {
  publishedCount: number;
  costMtd: number;
  ga4VisitorsPair: Ga4Block<{ thisMonth: number; lastMonth: number }>;
  avgScorePair: Awaited<ReturnType<typeof fetchAvgScorePair>>;
  nextMonthScheduleCount: number;
  nextMonthName: number;
  recommendations: { rank: number; title: string; tags: NonNullable<TopicFactors['tags']>; score: number }[];
  recent: HomeRecentItem[];
  recentMetrics: Ga4Block<Record<string, PathMetrics>>;
  /** GA4 범위 해석 실패 사유 (domain_required 면 화면이 도메인 선택을 띄운다) */
  ga4Reason: Ga4UnavailableReason | null;
}

/** ?domainId= 쿼리 검증 — 형식만 확인하고 소유 여부는 resolveGa4Scope 가 ownerId 로 검증(타인 도메인 = unmapped) */
export function parseDomainId(v: string | string[] | undefined): string | null {
  return isEntityId(v) ? v : null;
}

function scoreAvgOf(scores: unknown): number | null {
  if (!scores || typeof scores !== 'object' || Array.isArray(scores)) return null;
  const avg = (scores as Record<string, unknown>).avg;
  return typeof avg === 'number' ? avg : null;
}

export async function loadHomeData(ownerId: string | null, domainId: string | null): Promise<HomeData> {
  const now = kstNow();
  const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthStart = `${monthStr}-01`;
  const today = `${monthStr}-${String(now.getDate()).padStart(2, '0')}`;

  const monthStartDate = new Date(`${monthStr}-01T00:00:00Z`);
  const monthEndDate = new Date(monthStartDate.getFullYear(), monthStartDate.getMonth() + 1, 1);

  // 조회 예외는 페이지 전체 500 대신 해당 KPI 만 '연결 오류'로 (단 0 표시 없음)
  const GA4_THROWN: Ga4Block<never> = { state: 'error', code: 'upstream_error', retryable: true };
  const ga4Scope = ownerId ? await resolveGa4Scope(ownerId, domainId ?? undefined).catch(() => null) : null;
  const ga4Reason: Ga4UnavailableReason | null = ga4Scope && !ga4Scope.ok ? ga4Scope.reason : ownerId ? null : 'not_configured';
  const scopeFail: Ga4Block<never> = ownerId && !ga4Scope ? GA4_THROWN : { state: ga4Reason ?? 'not_configured' };
  const scope = ga4Scope?.ok ? ga4Scope.scope : null;

  const [recentRows, publishedCount, costMtd, ga4VisitorsPair, avgScorePair, nextMonthScheduleCount, topicRows] =
    await Promise.all([
      // 본인 콘텐츠만 — 이 목록의 경로를 본인 GA4 속성으로 조회하므로 타 소유자 글이 섞이면 안 된다
      prisma.content.findMany({
        where: { ownerId: ownerId ?? '' },
        select: { id: true, channel: true, topic: true, scores: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 3,
      }),
      prisma.scheduleSlot.count({
        where: { ownerId: ownerId ?? '', status: 'published', scheduledAt: { gte: monthStartDate, lt: monthEndDate } },
      }),
      // 홈 KPI 는 전부 본인 범위 — ownerId 없으면 빈 문자열로 0건 매칭(전체 집계 금지)
      ownerId ? getMonthlySpendKrw(ownerId).catch(() => 0) : Promise.resolve(0),
      scope ? fetchMonthlyVisitorsPair(scope).then(toGa4Block, () => GA4_THROWN) : Promise.resolve(scopeFail),
      fetchAvgScorePair(ownerId ?? '', monthStr),
      fetchUpcomingMonthScheduleCount(ownerId ?? ''),
      // 본인 추천만 (N4 — ownerId 조건 없으면 다른 테넌트의 추천 토픽이 노출된다)
      prisma.topicRecommendation.findMany({
        where: { ownerId: ownerId ?? '', weekStart: getMondayOfWeekKST(), channel: 'blog' },
        orderBy: { score: 'desc' },
        take: 5,
        select: { id: true, topic: true, score: true, factors: true },
      }),
    ]);

  const recommendations = topicRows.map((row, idx) => ({
    rank: idx + 1,
    title: row.topic,
    tags: ((row.factors ?? {}) as TopicFactors).tags ?? [],
    score: Math.round(row.score),
  }));

  // ── 2차: 최근 콘텐츠 GA4 path 조회 (host 일치분만) ─────────────────
  const recentPaths = await fetchRecentContentPaths(recentRows.map(c => c.id));
  const pathById = new Map(recentPaths.map(r => [r.contentId, r]));
  const recent: HomeRecentItem[] = recentRows.map(c => {
    const p = pathById.get(c.id);
    const path = p?.path ?? null;
    return {
      id: c.id, topic: c.topic, channel: c.channel, createdAt: c.createdAt, scoreAvg: scoreAvgOf(c.scores),
      path,
      otherHost: !!scope && path !== null && normalizeGa4Host(p?.host ?? '') !== normalizeGa4Host(scope.host),
    };
  });
  const queryPaths = [...new Set(recent.filter(r => r.path !== null && !r.otherHost).map(r => r.path as string))];

  const recentMetrics: Ga4Block<Record<string, PathMetrics>> = !scope
    ? scopeFail
    : queryPaths.length > 0
      ? await fetchMultiplePathMetrics(queryPaths, monthStart, today, scope).then(toGa4Block, () => GA4_THROWN)
      : { state: 'ok', data: {}, collected_at: '', host: scope.host, property_id: scope.propertyId };

  return {
    publishedCount, costMtd, ga4VisitorsPair, avgScorePair, nextMonthScheduleCount,
    nextMonthName: nextMonthInfo(now).month,
    recommendations, recent, recentMetrics, ga4Reason,
  };
}
