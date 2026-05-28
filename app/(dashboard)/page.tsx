// app/(dashboard)/page.tsx — marketing/app 대시보드 (Prisma 변환)

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { getMonthlySpendKrw } from '@/lib/cost/tracker';
import { fetchMonthlyVisitorsPair, fetchMultiplePathMetrics } from '@/lib/ga4/visitors';
import { DashboardCalendar } from './DashboardCalendar';
import { RefreshTopicsButton } from './components/RefreshTopicsButton';
import {
  fetchAvgScorePair,
  fetchUpcomingMonthScheduleCount,
  fetchRecentContentPaths,
} from '@/lib/dashboard/dashboard-stats';
import { gradeFromScore, calcMonthDelta, calcScoreDelta, nextMonthInfo } from '@/lib/dashboard/grades';
import { kstNow } from '@/lib/ga4/_internal';

// ── 페이지 ──────────────────────────────────────────────────────────

const BUDGET_MONTHLY = 500000;

interface TopicFactors {
  tags?: { label: string; type: 's' | 'e' | 't' }[];
  reason?: string;
  ga4_unavailable?: boolean;
}

export default async function DashboardPage() {
  const now = kstNow();
  const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthYmd = `${monthStr}-01`;
  const monthStart = monthYmd;
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const nextInfo = nextMonthInfo(now);
  const nextMonthName = nextInfo.month;

  // 월 시작/종료 날짜 계산
  const monthStartDate = new Date(`${monthStr}-01T00:00:00Z`);
  const nextMonth = monthStartDate.getMonth() + 1;
  const monthEndDate = new Date(monthStartDate.getFullYear(), nextMonth, 1);

  // ── 1차 데이터 로딩 ──────────────────────────────────────────────
  const [recent, publishedCount, costMtd, ga4VisitorsPair, avgScorePair, nextMonthScheduleCount, topicRows] =
    await Promise.all([
      prisma.content.findMany({
        select: { id: true, channel: true, topic: true, status: true, scores: true, costKrw: true, createdAt: true, updatedAt: true },
        orderBy: { createdAt: 'desc' },
        take: 3,
      }),
      prisma.scheduleSlot.count({
        where: {
          status: 'published',
          scheduledAt: { gte: monthStartDate, lt: monthEndDate },
        },
      }),
      getMonthlySpendKrw().catch(() => 0),
      fetchMonthlyVisitorsPair().catch(() => null),
      fetchAvgScorePair(monthStr),
      fetchUpcomingMonthScheduleCount(),
      (async () => {
        const { getMondayOfWeekKST } = await import('@/lib/topics/week-utils');
        const weekStart = getMondayOfWeekKST();
        return prisma.topicRecommendation.findMany({
          where: { weekStart, channel: 'blog' },
          orderBy: { score: 'desc' },
          take: 5,
          select: { id: true, topic: true, score: true, factors: true },
        });
      })(),
    ]);

  const budgetPct = ((costMtd / BUDGET_MONTHLY) * 100).toFixed(1);

  const recommendations = topicRows.map((row, idx) => {
    const factors = (row.factors ?? {}) as TopicFactors;
    return {
      rank: idx + 1,
      title: row.topic,
      tags: factors.tags ?? [],
      score: Math.round(row.score),
    };
  });

  // ── 2차: 최근 콘텐츠 GA4 path 조회 ──────────────────────────────
  const recentIds = recent.map(c => c.id);
  const recentPaths = await fetchRecentContentPaths(recentIds);

  const validPaths = recentPaths
    .map(r => r.path)
    .filter((p): p is string => p !== null);

  const recentMetrics = validPaths.length > 0
    ? await fetchMultiplePathMetrics(validPaths, monthStart, today).catch(() => null)
    : {};

  const pathMap = new Map(recentPaths.map(r => [r.contentId, r.path]));

  // ── 변화율 계산 ──────────────────────────────────────────────────
  const thisMonthVisitors = ga4VisitorsPair?.thisMonth ?? null;
  const lastMonthVisitors = ga4VisitorsPair?.lastMonth ?? null;
  const visitorDelta = calcMonthDelta(thisMonthVisitors, lastMonthVisitors);

  const scoreDelta = calcScoreDelta(avgScorePair.thisAvg, avgScorePair.lastAvg);

  const barColors = ['#2563EB', '#7C3AED', '#4338CA'];

  return (
    <>
      {/* ── KPI ── */}
      <div className="kpi-row">

        {/* ① 방문자 KPI */}
        <div className="kpi-card">
          <div className="kpi-icon-wrap" style={{background:'var(--c50)'}}>
            <svg className="icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
            </svg>
          </div>
          <div className="kpi-body">
            <div className="kpi-label">이번달 방문자 (GA4)</div>
            <div className="kpi-val">
              {ga4VisitorsPair
                ? ga4VisitorsPair.thisMonth.toLocaleString()
                : <span style={{color:'var(--sub)'}}>—</span>}
            </div>
            {visitorDelta === null ? (
              <div className="kpi-change">
                <span style={{color:'var(--sub)'}}>—</span>
                <span className="data-missing" title="GA4 응답 없음">·</span>
                <span style={{color:'var(--sub)',fontWeight:400}}>전월 대비</span>
              </div>
            ) : visitorDelta >= 0 ? (
              <div className="kpi-change up">
                <svg className="icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <polyline points="18,15 12,9 6,15"/>
                </svg>
                {Math.abs(visitorDelta).toFixed(1)}%{' '}
                <span style={{color:'var(--sub)',fontWeight:400}}>전월 대비</span>
              </div>
            ) : (
              <div className="kpi-change down">
                <svg className="icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <polyline points="6,9 12,15 18,9"/>
                </svg>
                {Math.abs(visitorDelta).toFixed(1)}%{' '}
                <span style={{color:'var(--sub)',fontWeight:400}}>전월 대비</span>
              </div>
            )}
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon-wrap" style={{background:'var(--green-100)'}}>
            <svg className="icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="1.8" strokeLinecap="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              <polyline points="14,2 14,8 20,8"/><polyline points="9,15 11,17 15,13"/>
            </svg>
          </div>
          <div className="kpi-body">
            <div className="kpi-label">이번달 발행 완료</div>
            <div className="kpi-val">{publishedCount} <span>건</span></div>
            <div className="kpi-change up">
              <svg className="icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="18,15 12,9 6,15"/></svg>
              이번달 누적
            </div>
          </div>
        </div>

        {/* ② AI 평균 검수 */}
        <div className="kpi-card">
          <div className="kpi-icon-wrap" style={{background:'var(--amber-100)'}}>
            <svg className="icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="1.8" strokeLinecap="round">
              <polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/>
            </svg>
          </div>
          <div className="kpi-body">
            <div className="kpi-label">AI 평균 검수 점수</div>
            <div className="kpi-val">
              {avgScorePair.thisAvg ?? <span style={{color:'var(--sub)'}}>—</span>}
              {avgScorePair.thisAvg !== null && <span>점</span>}
            </div>
            {scoreDelta === null ? (
              <div className="kpi-change">
                <span style={{color:'var(--sub)'}}>—</span>
                <span style={{color:'var(--sub)',fontWeight:400}}>전월 대비</span>
              </div>
            ) : scoreDelta >= 0 ? (
              <div className="kpi-change up">
                <svg className="icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <polyline points="18,15 12,9 6,15"/>
                </svg>
                {Math.abs(scoreDelta)}점{' '}
                <span style={{color:'var(--sub)',fontWeight:400}}>전월 대비</span>
              </div>
            ) : (
              <div className="kpi-change down">
                <svg className="icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <polyline points="6,9 12,15 18,9"/>
                </svg>
                {Math.abs(scoreDelta)}점{' '}
                <span style={{color:'var(--sub)',fontWeight:400}}>전월 대비</span>
              </div>
            )}
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon-wrap" style={{background:'var(--c50)'}}>
            <svg className="icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
              <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
            </svg>
          </div>
          <div className="kpi-body">
            <div className="kpi-label">이번달 API 비용</div>
            <div className="kpi-val">{costMtd.toLocaleString()} <span>원</span></div>
            <div className="kpi-note">예산 {(BUDGET_MONTHLY/10000).toFixed(0)}만원의 {budgetPct}% 사용</div>
          </div>
        </div>

      </div>

      {/* ── 미드: 캘린더 + 오른쪽 ── */}
      <div className="mid-row">

        <DashboardCalendar />

        <div className="right-col">

          {nextMonthScheduleCount > 0 && (
            <div className="ai-banner">
              <div className="ai-banner-tag">
                <svg className="icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/>
                </svg>
                AI 자동 편성
              </div>
              <div className="ai-banner-title">{nextMonthName}월 콘텐츠 일정 준비됨</div>
              <div className="ai-banner-sub">
                GA4 + 시즌 분석 완료.<br/>
                {nextMonthScheduleCount}건의 최적 일정이 자동 편성됐어요.
              </div>
              <Link
                href="/scheduler"
                className="btn btn-full"
                style={{background:'rgba(255,255,255,0.15)',color:'#fff',border:'1px solid rgba(255,255,255,0.2)'}}
              >
                {nextMonthName}월 일정 확인하기
                <svg className="icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <polyline points="9,18 15,12 9,6"/>
                </svg>
              </Link>
            </div>
          )}

          {/* 추천 토픽 */}
          <div className="card">
            <div className="card-head">
              <svg className="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
                <polyline points="23,6 13.5,15.5 8.5,10.5 1,18"/><polyline points="17,6 23,6 23,12"/>
              </svg>
              <span className="card-title">이번 주 추천 토픽 TOP 5</span>
              <span style={{fontSize:10,color:'var(--sub)',marginLeft:'auto',display:'inline-flex',alignItems:'center',gap:8}}>
                <span>매주 월요일 갱신</span>
                <RefreshTopicsButton />
              </span>
            </div>
            {recommendations.length === 0 ? (
              <div style={{padding:'24px 16px',textAlign:'center',color:'var(--sub)',fontSize:12,lineHeight:1.6}}>
                아직 추천이 없습니다.<br/>
                상단 갱신 버튼을 눌러 이번 주 추천을 생성하세요.
              </div>
            ) : (
              <div className="topic-list">
                {recommendations.map(({rank, title, tags, score}) => (
                  <Link
                    key={rank}
                    href={`/content/create?topic=${encodeURIComponent(title)}`}
                    className="topic-item"
                    style={{textDecoration:'none',color:'inherit',cursor:'pointer'}}
                  >
                    <div className={`t-rank${rank===1?' r1':rank===2?' r2':''}`}>{rank}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div className="t-title">{title}</div>
                      <div className="t-tags">
                        {tags.map(({label, type}) => (
                          <span key={label} className={`t-tag tag-${type}`}>{label}</span>
                        ))}
                      </div>
                    </div>
                    <div className="t-score">
                      <div className="t-score-n">{score}</div>
                      <div className="t-score-l">점수</div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
            <div className="topic-foot">
              <Link
                href="/content/create"
                className="btn btn-primary btn-full"
                style={{fontSize:12, opacity: recommendations.length === 0 ? 0.5 : 1, pointerEvents: recommendations.length === 0 ? 'none' : 'auto'}}
                aria-disabled={recommendations.length === 0}
              >
                토픽 선택해서 바로 생성
                <svg className="icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <polyline points="9,18 15,12 9,6"/>
                </svg>
              </Link>
            </div>
          </div>

          {/* 최근 발행 성과 */}
          <div className="card">
            <div className="card-head">
              <svg className="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
                <path d="M18 20V10M12 20V4M6 20v-6"/>
              </svg>
              <span className="card-title">최근 발행 성과</span>
              <Link href="/analytics" style={{fontSize:11,color:'var(--c400)',marginLeft:'auto'}}>전체 보기</Link>
            </div>
            {recent.length === 0 ? (
              <div style={{padding:'24px',textAlign:'center',color:'var(--sub)',fontSize:12}}>발행된 콘텐츠가 없습니다</div>
            ) : recent.map((c, i) => {
              const scoreAvg =
                c.scores &&
                typeof c.scores === 'object' &&
                !Array.isArray(c.scores) &&
                'avg' in c.scores &&
                typeof (c.scores as Record<string, unknown>).avg === 'number'
                  ? (c.scores as Record<string, unknown>).avg as number
                  : null;
              const { letter: gl, cls: gc } = gradeFromScore(scoreAvg);
              const ch = c.channel === 'blog' ? '블로그' : c.channel === 'instagram' ? '인스타그램' : '페이스북';

              const path = pathMap.get(c.id) ?? null;
              const metrics = path && recentMetrics ? recentMetrics[path] ?? null : null;

              const viewsDisplay = path === null
                ? <span title="발행 URL 없음" style={{color:'var(--sub)'}}>—</span>
                : metrics === null
                  ? <span title="GA4 미수집" style={{color:'var(--sub)'}}>—</span>
                  : metrics.screenPageViews.toLocaleString();

              const clicksDisplay = path === null
                ? <span title="발행 URL 없음" style={{color:'var(--sub)'}}>—</span>
                : metrics === null
                  ? <span title="GA4 미수집" style={{color:'var(--sub)'}}>—</span>
                  : metrics.sessions.toLocaleString();

              return (
                <div key={c.id} className="perf-item">
                  <div className="p-bar" style={{background: barColors[i] ?? '#2563EB'}}></div>
                  <div className={`p-grade ${gc}`}>{gl}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div className="p-title">{c.topic}</div>
                    <div className="p-date">{ch} · {new Date(c.createdAt.toString()).toLocaleDateString('ko-KR',{month:'long',day:'numeric'})}</div>
                  </div>
                  <div className="p-stats">
                    <div><div className="p-stat-n">{viewsDisplay}</div><div className="p-stat-l">조회</div></div>
                    <div><div className="p-stat-n">{clicksDisplay}</div><div className="p-stat-l">클릭</div></div>
                  </div>
                </div>
              );
            })}
          </div>

        </div>
      </div>
    </>
  );
}
