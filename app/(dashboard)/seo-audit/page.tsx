'use client';

// app/(dashboard)/seo-audit/page.tsx
// SEO 진단 대시보드 — 패칭·조립만 (≤500줄). 표시=components/, 패칭·상태=hooks/.
// 설계 §1.2·§8 계약을 따르며 수집/판정/점수/집계 알고리즘은 포함하지 않는다(서버 lib/seo).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Market } from '@/types/visibility';
import type { SeoAuditDTO } from '@/types/seo';
import { SeoGate, useSeoAccess } from './components/SeoGate';
import { SeoDomainSelector } from './components/SeoDomainSelector';
import { AuditRunPanel } from './components/AuditRunPanel';
import { AuditStatus } from './components/AuditStatus';
import { TechnicalScoreCard } from './components/TechnicalScoreCard';
import { TechnicalChecklist } from './components/TechnicalChecklist';
import { KeywordOpportunities } from './components/KeywordOpportunities';
import { KeywordRankingTable } from './components/KeywordRankingTable';
import { AuditHistory } from './components/AuditHistory';
import { DEFAULT_MARKET, formatPercent } from './constants';
import { SeoApiError } from './api';
import { useDomains } from './hooks/use-domains';
import { useAuditHistory, useAuditDetail } from './hooks/use-seo-audit';
import { useKeywords } from './hooks/use-seo-keywords';
import { useRankings } from './hooks/use-seo-rankings';

function errMsg(err: unknown): string | null {
  if (!err) return null;
  if (err instanceof SeoApiError) return err.message;
  if (err instanceof Error) return err.message;
  return '요청을 처리하지 못했습니다';
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

/** 게이트 내부 본문 — useSeoAccess(쓰기 권한)를 소비한다. */
function SeoAuditContent() {
  const { canWrite } = useSeoAccess();

  const [selectedDomainId, setSelectedDomainId] = useState<string | null>(null);
  const [activeAuditId, setActiveAuditId] = useState<string | null>(null);

  // 현재 선택 도메인을 ref 로 추적 — 늦게 도착한 다른 도메인의 실행 응답이 활성 ID 를 덮지 않도록(지적 4).
  const selectedDomainRef = useRef<string | null>(null);
  selectedDomainRef.current = selectedDomainId;
  const handleAuditResult = useCallback((a: SeoAuditDTO) => {
    if (a.domainId !== selectedDomainRef.current) return; // 전환된 뒤 도착한 과거 도메인 응답 무시
    setActiveAuditId(a.id);
  }, []);

  // 도메인 목록 (기존 GEO Domain 공유)
  const domainsQuery = useDomains();
  const domains = useMemo(() => domainsQuery.data ?? [], [domainsQuery.data]);

  // 첫 도메인 자동 선택 (목록 로드 후)
  useEffect(() => {
    if (!selectedDomainId && domains.length > 0) setSelectedDomainId(domains[0].id);
  }, [domains, selectedDomainId]);

  const selectedDomain = domains.find((d) => d.id === selectedDomainId) ?? null;
  const market: Market = selectedDomain?.market ?? DEFAULT_MARKET;

  // 진단 이력
  const historyQuery = useAuditHistory(selectedDomainId);
  const audits = useMemo(
    () => historyQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [historyQuery.data],
  );

  // 활성 진단 자동 선택 = 이력 최신 (사용자가 아직 고르지 않았을 때)
  useEffect(() => {
    if (!activeAuditId && audits.length > 0) setActiveAuditId(audits[0].id);
  }, [audits, activeAuditId]);

  // 도메인 변경 시 활성 진단 초기화
  const handleSelectDomain = (id: string) => {
    setSelectedDomainId(id);
    setActiveAuditId(null);
  };

  // 단건 상세 (pending 폴링 포함). pollExhausted·manualCheck 는 훅이 실제 요청 횟수로 판정(지적 6).
  const { query: detailQuery, pollExhausted, manualCheck } = useAuditDetail(selectedDomainId, activeAuditId);
  const activeAudit = detailQuery.data ?? null;

  // 키워드·순위 (무과금 조회)
  const keywordsQuery = useKeywords({ domainId: selectedDomainId ?? '', limit: 50 });
  const keywords = useMemo(
    () => keywordsQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [keywordsQuery.data],
  );
  const rankingsQuery = useRankings({ domainId: selectedDomainId ?? '', limit: 50 });
  const rankings = useMemo(
    () => rankingsQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [rankingsQuery.data],
  );

  // 재개 가능 실행(진행 중/부분)
  const resumable = activeAudit && (activeAudit.status === 'pending' || activeAudit.status === 'partial') ? activeAudit : null;

  const hasTechnical = !!activeAudit && (activeAudit.technicalScore !== null || activeAudit.checks.length > 0);

  // KPI 요약 — 로드된 목록 부분집계임을 라벨/서브로 명시(지적 11). 전체 집계를 위해 모든 페이지를 강제 로드하지 않는다.
  const opportunityCount = useMemo(() => keywords.filter((k) => k.isOpportunity).length, [keywords]);
  const loadedSuffix = (more: boolean) => (more ? '+' : '');

  if (!selectedDomainId && domains.length === 0 && !domainsQuery.isPending) {
    return (
      <SeoDomainSelector
        domains={domains}
        loading={domainsQuery.isPending}
        error={errMsg(domainsQuery.error)}
        selectedId={selectedDomainId}
        onSelect={handleSelectDomain}
        onRetry={() => domainsQuery.refetch()}
      />
    );
  }

  return (
    <>
      <SeoDomainSelector
        domains={domains}
        loading={domainsQuery.isPending}
        error={errMsg(domainsQuery.error)}
        selectedId={selectedDomainId}
        onSelect={handleSelectDomain}
        onRetry={() => domainsQuery.refetch()}
      />

      {selectedDomainId && (
        <>
          {/* KPI 요약 (로드분 기준·선택 진단 기준) */}
          <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <Kpi label="기술 점수 (선택 진단)" value={activeAudit?.technicalScore != null ? `${activeAudit.technicalScore}` : '—'} sub={activeAudit?.coverage != null ? `커버 ${formatPercent(activeAudit.coverage)}` : '기술 점수 없는 진단'} />
            <Kpi label="저장 키워드 (로드분)" value={`${keywords.length}${loadedSuffix(!!keywordsQuery.hasNextPage)}개`} />
            <Kpi label="기회 키워드 (로드분)" value={`${opportunityCount}${loadedSuffix(!!keywordsQuery.hasNextPage)}개`} />
            <Kpi label="순위 스냅샷 (로드분)" value={`${rankings.length}${loadedSuffix(!!rankingsQuery.hasNextPage)}건`} sub="최근 30일" />
          </div>

          <AuditRunPanel
            key={selectedDomainId} // 도메인 전환 시 폼·엔진·멱등키 상태 초기화(지적 4)
            domainId={selectedDomainId}
            market={market}
            canWrite={canWrite}
            resumable={resumable}
            onAudit={handleAuditResult}
          />

          {/* 활성 진단 상세 — 선택했는데 조회 실패/대기면 분리 표시·재조회(지적 7) */}
          {activeAuditId && detailQuery.isError && (
            <div className="card" style={{ textAlign: 'center', padding: '28px 20px' }}>
              <p role="alert" style={{ fontSize: 12.5, color: '#dc2626' }}>진단 상세를 불러오지 못했습니다.</p>
              <p style={{ fontSize: 11.5, color: 'var(--sub)', marginTop: 4 }}>{errMsg(detailQuery.error)}</p>
              <button type="button" className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => detailQuery.refetch()}>상세 다시 조회</button>
            </div>
          )}
          {activeAuditId && !detailQuery.isError && detailQuery.isPending && (
            <div className="card" style={{ display: 'flex', justifyContent: 'center', padding: '28px 0' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--blue-400)" strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
                <path d="M21 12a9 9 0 11-6.219-8.56" />
              </svg>
            </div>
          )}
          {activeAudit && <AuditStatus audit={activeAudit} pollExhausted={pollExhausted} onManualCheck={manualCheck} manualChecking={detailQuery.isFetching} />}
          {hasTechnical && activeAudit && (
            <>
              <TechnicalScoreCard audit={activeAudit} />
              <TechnicalChecklist checks={activeAudit.checks} />
            </>
          )}

          {/* 키워드·순위 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <KeywordOpportunities
              key={selectedDomainId} // 도메인 전환 시 선택·입력·멱등키 상태 초기화(지적 4)
              domainId={selectedDomainId}
              keywords={keywords}
              loading={keywordsQuery.isPending}
              error={errMsg(keywordsQuery.error)}
              hasMore={!!keywordsQuery.hasNextPage}
              fetchingMore={keywordsQuery.isFetchingNextPage}
              canWrite={canWrite}
              onAudit={handleAuditResult}
              onLoadMore={() => keywordsQuery.fetchNextPage()}
              onRetry={() => keywordsQuery.refetch()}
            />
            <KeywordRankingTable
              rankings={rankings}
              loading={rankingsQuery.isPending}
              error={errMsg(rankingsQuery.error)}
              hasMore={!!rankingsQuery.hasNextPage}
              fetchingMore={rankingsQuery.isFetchingNextPage}
              onLoadMore={() => rankingsQuery.fetchNextPage()}
              onRetry={() => rankingsQuery.refetch()}
            />
          </div>

          {/* 이력 */}
          <AuditHistory
            audits={audits}
            loading={historyQuery.isPending}
            error={errMsg(historyQuery.error)}
            hasMore={!!historyQuery.hasNextPage}
            fetchingMore={historyQuery.isFetchingNextPage}
            activeId={activeAuditId}
            onSelect={setActiveAuditId}
            onLoadMore={() => historyQuery.fetchNextPage()}
            onRetry={() => historyQuery.refetch()}
          />
        </>
      )}
    </>
  );
}

export default function SeoAuditPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h1 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>SEO 진단</h1>
        <p style={{ fontSize: 12, color: 'var(--sub)', marginTop: 2 }}>
          도메인의 기술 SEO 상태를 점검하고 Google·네이버 키워드 수요·순위를 추적합니다
        </p>
      </div>

      <SeoGate>
        <SeoAuditContent />
      </SeoGate>
    </div>
  );
}
