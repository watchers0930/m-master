'use client';

// app/(dashboard)/visibility/page.tsx
// AI 가시성 추적 대시보드 — 패칭·조립만 (≤500줄). 표시=components/, 패칭·상태=hooks/.
// 설계 §1.2·§3.8 계약을 따르며 알고리즘은 포함하지 않는다.

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { DEFAULT_MARKET, MARKET_LABELS } from './constants';
import { VisibilityGate } from './components/VisibilityGate';
import { VisibilityFilters, type FiltersState } from './components/VisibilityFilters';
import { EngineBreakdown } from './components/EngineBreakdown';
import { SovTrendChart } from './components/SovTrendChart';
import { CompetitorCompare } from './components/CompetitorCompare';
import { CitationSources } from './components/CitationSources';
import { QueryManager } from './components/QueryManager';
import { useDomains } from './hooks/use-domains';
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

function VisibilityPageInner() {
  const initialRange = useMemo(() => recentRange(30), []);
  const [filters, setFilters] = useState<FiltersState>({
    market: DEFAULT_MARKET,
    from: initialRange.from,
    to: initialRange.to,
    queryId: null,
    engine: null,
  });

  // 컨설팅 등 타 화면에서 넘어온 domainId 딥링크 — 소유 도메인과 대조해 질문 범위·시장을 좁힌다(지적 2).
  const searchParams = useSearchParams();
  const requestedDomainId = searchParams.get('domainId');
  const domainsQuery = useDomains(!!requestedDomainId);
  const scopedDomain = requestedDomainId
    ? domainsQuery.data?.find((d) => d.id === requestedDomainId) ?? null
    : null;
  // 딥링크 ID 가 소유 목록에 없으면(미존재·타 소유자) 범위를 적용하지 않고 안내만 한다.
  const deepLinkUnresolved = !!requestedDomainId && !domainsQuery.isPending && !scopedDomain;

  // 질문 목록 (필터 드롭다운 + 질문 관리 공용 — react-query 캐시 공유)
  const queriesQuery = useVisibilityQueries({ limit: 100 });
  const queries = queriesQuery.data?.pages.flatMap((page) => page.data) ?? [];

  // 딥링크 도메인으로 좁힌 질문 목록(집계 API 는 도메인 필터가 없어 질문 범위만 좁힌다 — 아래 안내로 명시).
  const scopedQueries = scopedDomain ? queries.filter((q) => q.domainId === scopedDomain.id) : queries;

  // 유효 딥링크면 시장 필터를 해당 도메인 시장으로 1회 맞춘다(이후 사용자의 수동 변경은 덮지 않음).
  const appliedScopeRef = useRef(false);
  useEffect(() => {
    if (appliedScopeRef.current || !scopedDomain) return;
    appliedScopeRef.current = true;
    setFilters((f) => ({ ...f, market: scopedDomain.market, queryId: null }));
  }, [scopedDomain]);

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
        {/* 딥링크 도메인 범위 안내 (지적 2) — 집계 KPI·차트는 시장 전체 기준임을 명시 */}
        {scopedDomain && (
          <div role="status" className="card" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: '10px 16px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11.5, color: 'var(--text)', flex: 1, minWidth: 220, lineHeight: 1.6 }}>
              <strong>{scopedDomain.url}</strong> 도메인의 추적 질문 {scopedQueries.length}개로 좁혔습니다.
              KPI·차트 집계는 시장({MARKET_LABELS[scopedDomain.market]}) 전체 기준입니다.
            </span>
            <Link href="/visibility" className="btn btn-ghost" style={{ padding: '4px 10px', flexShrink: 0 }}>전체 보기</Link>
          </div>
        )}
        {deepLinkUnresolved && (
          <div role="status" className="card" style={{ padding: '10px 16px' }}>
            <span style={{ fontSize: 11.5, color: 'var(--sub)' }}>요청한 도메인을 찾을 수 없어 전체 기준으로 표시합니다.</span>
          </div>
        )}
        {queriesQuery.hasNextPage && (
          <button className="btn btn-ghost" disabled={queriesQuery.isFetchingNextPage} onClick={() => queriesQuery.fetchNextPage()}>
            {queriesQuery.isFetchingNextPage ? '불러오는 중…' : '질문 더 보기'}
          </button>
        )}
        <VisibilityFilters value={filters} queries={scopedQueries} onChange={setFilters} />

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

export default function VisibilityPage() {
  // useSearchParams 는 Suspense 경계가 필요하다(Next.js app router).
  return (
    <Suspense fallback={null}>
      <VisibilityPageInner />
    </Suspense>
  );
}
