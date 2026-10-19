'use client';

// app/(dashboard)/visibility/page.tsx
// AI 가시성 추적 대시보드 — 패칭·조립만 (≤500줄). 표시=components/, 패칭·상태=hooks/.
// 설계 §1.2·§3.8 계약을 따르며 알고리즘은 포함하지 않는다.

import { useMemo, useState } from 'react';
import { DEFAULT_MARKET } from './constants';
import { VisibilityGate } from './components/VisibilityGate';
import { VisibilityFilters, type FiltersState } from './components/VisibilityFilters';
import { EngineBreakdown } from './components/EngineBreakdown';
import { SovTrendChart } from './components/SovTrendChart';
import { CompetitorCompare } from './components/CompetitorCompare';
import { CitationSources } from './components/CitationSources';
import { QueryManager } from './components/QueryManager';
import { useVisibilityQueries } from './hooks/use-visibility-queries';
import { useVisibilityData } from './hooks/use-visibility-data';

/** 최근 N일 기간 (YYYY-MM-DD) */
function recentRange(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - days);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(from), to: fmt(to) };
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi-card" style={{ paddingLeft: 14 }}>
      <div className="kpi-body" style={{ justifyContent: 'space-between' }}>
        <span className="kpi-label">{label}</span>
        <span style={{ textAlign: 'right' }}>
          <span className="kpi-val">{value}</span>
          {sub && <span style={{ display: 'block', fontSize: 10, color: 'var(--sub)' }}>{sub}</span>}
        </span>
      </div>
    </div>
  );
}

export default function VisibilityPage() {
  const initialRange = useMemo(() => recentRange(30), []);
  const [filters, setFilters] = useState<FiltersState>({
    market: DEFAULT_MARKET,
    from: initialRange.from,
    to: initialRange.to,
    queryId: null,
    engine: null,
  });

  // 질문 목록 (필터 드롭다운 + 질문 관리 공용 — react-query 캐시 공유)
  const queriesQuery = useVisibilityQueries({ limit: 100 });
  const queries = queriesQuery.data?.pages.flatMap((page) => page.data) ?? [];

  // 집계 데이터
  const dataQuery = useVisibilityData({
    market: filters.market,
    from: filters.from,
    to: filters.to,
    queryId: filters.queryId,
    engine: filters.engine,
  });
  const data = dataQuery.data;

  // KPI 요약 (전체 엔진 평균 SoV — 표본 가중)
  const summary = useMemo(() => {
    if (!data) return null;
    const withSamples = data.engines.filter((e) => e.validSamples > 0);
    const totalMentioned = withSamples.reduce((a, e) => a + e.mentionedCount, 0);
    const totalCited = withSamples.reduce((a, e) => a + e.citedCount, 0);
    const denom = data.totalValidSamples;
    return {
      sov: denom > 0 ? `${Math.round((totalMentioned / denom) * 100)}%` : '데이터 없음',
      citation: denom > 0 ? `${Math.round((totalCited / denom) * 100)}%` : '데이터 없음',
      samples: denom,
      engines: withSamples.length,
    };
  }, [data]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h1 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>AI 가시성 추적</h1>
        <p style={{ fontSize: 12, color: 'var(--sub)', marginTop: 2 }}>
          ChatGPT·AI Overviews·Perplexity·Gemini 답변에서 브랜드 노출·인용을 추적합니다
        </p>
      </div>

      <VisibilityGate>
        {queriesQuery.hasNextPage && (
          <button className="btn btn-ghost" disabled={queriesQuery.isFetchingNextPage} onClick={() => queriesQuery.fetchNextPage()}>
            {queriesQuery.isFetchingNextPage ? '불러오는 중…' : '질문 더 보기'}
          </button>
        )}
        <VisibilityFilters value={filters} queries={queries} onChange={setFilters} />

        {/* KPI 요약 */}
        <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <Kpi label="평균 노출 점유" value={summary?.sov ?? '—'} />
          <Kpi label="평균 인용률" value={summary?.citation ?? '—'} />
          <Kpi label="유효 표본" value={summary ? `${summary.samples}건` : '—'} />
          <Kpi label="수집 엔진" value={summary ? `${summary.engines}개` : '—'} />
        </div>

        {/* 집계 로딩/에러/본문 */}
        {dataQuery.isPending ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--blue-400)" strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
              <path d="M21 12a9 9 0 11-6.219-8.56" />
            </svg>
          </div>
        ) : dataQuery.error ? (
          <div className="card" style={{ textAlign: 'center', padding: '36px 0' }}>
            <p style={{ color: '#dc2626', fontSize: 12.5 }}>{(dataQuery.error as Error).message}</p>
            <button type="button" className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => dataQuery.refetch()}>다시 시도</button>
          </div>
        ) : data ? (
          <>
            <SovTrendChart trend={data.trend} from={filters.from} to={filters.to} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <EngineBreakdown engines={data.engines} />
              <CompetitorCompare competitors={data.competitors} />
            </div>
            <CitationSources citations={data.citations} />
          </>
        ) : null}

        {/* 질문 관리 */}
        <QueryManager
          queries={queries}
          loading={queriesQuery.isPending}
          error={queriesQuery.error ? (queriesQuery.error as Error).message : null}
          defaultMarket={filters.market}
          onRetry={() => queriesQuery.refetch()}
        />
      </VisibilityGate>
    </div>
  );
}
