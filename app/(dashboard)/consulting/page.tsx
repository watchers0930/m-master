'use client';

// app/(dashboard)/consulting/page.tsx
// 마케팅 컨설팅 대시보드 — 패칭·조립만 (≤500줄). 표시=components/, 패칭·상태=hooks/.
// 설계 §7·§8 계약을 따르며 종합·검증·수치 계산은 포함하지 않는다(서버 lib/consulting).
// 열람 순서(§7): 진단요약 → 채널 믹스 → 예산 제안 → 우선순위 액션 → 이력.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { Market } from '@/types/visibility';
import type { ConsultingReportDTO, EvidenceRef } from './types';
import { DEFAULT_MARKET } from './constants';
import { ConsultingApiError } from './api';
import { ConsultingGate, useConsultingAccess } from './components/ConsultingGate';
import { ConsultingDomainSelector } from './components/ConsultingDomainSelector';
import { GenerationPanel } from './components/GenerationPanel';
import { ReportHeader } from './components/ReportHeader';
import { DiagnosisCard } from './components/DiagnosisCard';
import { ChannelMixCard } from './components/ChannelMixCard';
import { BudgetProposalCard } from './components/BudgetProposalCard';
import { PriorityActionsCard } from './components/PriorityActionsCard';
import { ReportSections } from './components/sections/ReportSections';
import { ReportHistory } from './components/ReportHistory';
import { useDomain, useDomains } from './hooks/use-domains';
import { useReportHistory, useReportDetail } from './hooks/use-consulting';

function errMsg(err: unknown): string | null {
  if (!err) return null;
  if (err instanceof ConsultingApiError) return err.message;
  if (err instanceof Error) return err.message;
  return '요청을 처리하지 못했습니다';
}

function Spinner() {
  return (
    <div className="card" style={{ display: 'flex', justifyContent: 'center', padding: '28px 0' }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--blue-400)" strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
        <path d="M21 12a9 9 0 11-6.219-8.56" />
      </svg>
    </div>
  );
}

/**
 * 완료 리포트 본문. evidence 토큰 치환 맵을 한 번 만들어 내려준다.
 * - v2(schemaVersion==='v2'): 구조화 6섹션 렌더(설계 §3.3). GTM 섹션이 기존 전략 카드를 재노출한다.
 * - v1(그 외): 기존 전략 카드(진단→채널→예산→액션) + "구조화 섹션은 재생성 필요" 안내(§3.2.5 degrade).
 * 프론트는 어느 경로에서도 수치를 재계산하지 않는다.
 */
function ReportBody({ report, domainId }: { report: ConsultingReportDTO; domainId: string }) {
  const evidenceById = useMemo(() => {
    const m = new Map<string, EvidenceRef>();
    for (const ev of report.evidence ?? []) m.set(ev.id, ev);
    return m;
  }, [report.evidence]);

  if (report.status !== 'completed') return null;

  // v2 구조화 경로 판정은 schemaVersion 으로 한다. 서버 reportDto 는 v1 에도 sections 를 합성해
  // 내려주므로(buildSections with evidence:[]·selection:[] → gtm.strategy=null) sections 존재만으로
  // 분기하면 v1 의 기존 진단·채널·예산·액션이 통째로 숨겨지는 회귀가 생긴다(설계 §2.6·§3.2.5).
  const isStructured = report.schemaVersion === 'v2' && !!report.sections;

  if (isStructured) {
    return <ReportSections sections={report.sections!} evidenceById={evidenceById} domainId={domainId} />;
  }

  // v1 하위호환 — 기존 전략 카드 유지(일괄 재저장 금지). 신규 구조화 섹션은 준비 필요로 안내.
  return (
    <>
      {report.diagnosis && <DiagnosisCard diagnosis={report.diagnosis} evidenceById={evidenceById} />}
      {report.channelMix && report.channelMix.length > 0 && (
        <ChannelMixCard channelMix={report.channelMix} evidenceById={evidenceById} />
      )}
      {report.budgetProposal && <BudgetProposalCard budget={report.budgetProposal} evidenceById={evidenceById} />}
      {report.priorityActions && report.priorityActions.length > 0 && (
        <PriorityActionsCard actions={report.priorityActions} evidenceById={evidenceById} domainId={domainId} />
      )}
      <div className="card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--sub)" strokeWidth="1.8" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}>
          <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
        </svg>
        <p style={{ fontSize: 11.5, color: 'var(--sub)', lineHeight: 1.6, margin: 0 }}>
          이 리포트는 이전 형식(v1)이라 수요 추이·키워드 지표 등 구조화 섹션이 준비되지 않았습니다. 새로 생성하면 최신 구조화 리포트로 제공됩니다.
        </p>
      </div>
    </>
  );
}

/** 게이트 내부 본문 — useConsultingAccess(쓰기 권한)를 소비한다. */
function ConsultingContent() {
  const { canWrite } = useConsultingAccess();

  const [selectedDomainId, setSelectedDomainId] = useState<string | null>(null);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);

  // 현재 선택 도메인을 ref 로 추적 — 늦게 도착한 다른 도메인의 생성 응답이 활성 ID 를 덮지 않도록(§7).
  const selectedDomainRef = useRef<string | null>(null);
  selectedDomainRef.current = selectedDomainId;

  const handleReport = useCallback((r: ConsultingReportDTO) => {
    if (r.domainId !== selectedDomainRef.current) return; // 전환 뒤 도착한 과거 도메인 응답 무시
    setActiveReportId(r.id);
  }, []);

  // 생성 중(409)·비용 미확정(uncertain) 기존 리포트 연결. 요청 domainId 가 현재 선택과 다르면(전환 뒤 지연 도착) 무시(§7·지적 1·4).
  const handlePendingReport = useCallback((reportId: string, domainId: string) => {
    if (domainId !== selectedDomainRef.current) return;
    setActiveReportId(reportId);
  }, []);

  const searchParams = useSearchParams();
  const requestedId = searchParams.get('domainId');
  const previousRequestedId = useRef(requestedId);
  useEffect(() => {
    if (previousRequestedId.current === requestedId) return;
    previousRequestedId.current = requestedId;
    setSelectedDomainId(null);
    setActiveReportId(null);
  }, [requestedId]);
  const [search, setSearch] = useState('');
  const domainsQuery = useDomains(search);
  // Direct links are resolved by an owner-scoped server query even outside loaded pages.
  const domainQuery = useDomain(selectedDomainId ?? requestedId);
  const domains = useMemo(() => {
    const rows = domainsQuery.data?.pages.flatMap(page => page.items) ?? [];
    const target = domainQuery.data;
    return target && !rows.some(d => d.id === target.id) ? [target, ...rows] : rows;
  }, [domainsQuery.data, domainQuery.data]);
  useEffect(() => {
    if (selectedDomainId) return;
    if (requestedId) {
      if (domainQuery.data?.id === requestedId) setSelectedDomainId(requestedId);
    } else if (domains.length) setSelectedDomainId(domains[0].id);
  }, [domains, selectedDomainId, requestedId, domainQuery.data]);

  const selectedDomain = domains.find((d) => d.id === selectedDomainId) ?? null;
  const market: Market = selectedDomain?.market ?? DEFAULT_MARKET;

  // 리포트 이력
  const historyQuery = useReportHistory(selectedDomainId);
  const reports = useMemo(
    () => historyQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [historyQuery.data],
  );

  // 활성 리포트 자동 선택 = 이력 최신 (사용자가 아직 고르지 않았을 때)
  useEffect(() => {
    if (!activeReportId && reports.length > 0) setActiveReportId(reports[0].id);
  }, [reports, activeReportId]);

  // 도메인 변경 시 활성 리포트 초기화
  const handleSelectDomain = (id: string) => {
    setSelectedDomainId(id);
    setActiveReportId(null);
  };

  // 단건 상세 (generating 폴링 포함)
  const { query: detailQuery, pollExhausted, manualCheck } = useReportDetail(selectedDomainId, activeReportId);
  const activeReport = detailQuery.data ?? null;

  return (
    <>
      <ConsultingDomainSelector
        domains={domains}
        loading={domainsQuery.isPending || (!!requestedId && !selectedDomainId && domainQuery.isPending)}
        error={errMsg(domainsQuery.error ?? domainQuery.error)}
        selectedId={selectedDomainId}
        onSelect={handleSelectDomain}
        onRetry={() => { domainsQuery.refetch(); if (selectedDomainId ?? requestedId) domainQuery.refetch(); }}
        search={search}
        onSearch={setSearch}
        hasMore={!!domainsQuery.hasNextPage}
        fetchingMore={domainsQuery.isFetchingNextPage}
        onLoadMore={() => domainsQuery.fetchNextPage()}
      />

      {selectedDomainId && (
        <>
          <GenerationPanel
            key={selectedDomainId} // 도메인 전환 시 예산 입력·에러 상태 초기화
            domainId={selectedDomainId}
            market={market}
            canWrite={canWrite}
            onReport={handleReport}
            onPendingReport={handlePendingReport}
          />

          {/* 활성 리포트 상세 — 선택했는데 조회 실패/대기면 분리 표시·재조회 */}
          {activeReportId && detailQuery.isError && (
            <div className="card" style={{ textAlign: 'center', padding: '28px 20px' }}>
              <p role="alert" style={{ fontSize: 12.5, color: '#dc2626' }}>리포트를 불러오지 못했습니다.</p>
              <p style={{ fontSize: 11.5, color: 'var(--sub)', marginTop: 4 }}>{errMsg(detailQuery.error)}</p>
              <button type="button" className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => detailQuery.refetch()}>다시 조회</button>
            </div>
          )}
          {activeReportId && !detailQuery.isError && detailQuery.isPending && <Spinner />}

          {activeReport && (
            <>
              <ReportHeader
                report={activeReport}
                domainUrl={selectedDomain?.url ?? null}
                pollExhausted={pollExhausted}
                onManualCheck={manualCheck}
                manualChecking={detailQuery.isFetching}
              />
              <ReportBody report={activeReport} domainId={selectedDomainId} />
            </>
          )}

          {/* 이력 */}
          <ReportHistory
            reports={reports}
            loading={historyQuery.isPending}
            error={errMsg(historyQuery.error)}
            hasMore={!!historyQuery.hasNextPage}
            fetchingMore={historyQuery.isFetchingNextPage}
            activeId={activeReportId}
            onSelect={setActiveReportId}
            onLoadMore={() => historyQuery.fetchNextPage()}
            onRetry={() => historyQuery.refetch()}
          />
        </>
      )}
    </>
  );
}

export default function ConsultingPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h1 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>마케팅 컨설팅</h1>
        <p style={{ fontSize: 12, color: 'var(--sub)', marginTop: 2 }}>
          저장된 SEO·GEO 진단을 종합해 채널 믹스·예산 배분·우선순위 액션을 제안합니다. GA4 성과는 현재 포함되지 않습니다.
        </p>
      </div>

      <ConsultingGate>
        <Suspense fallback={<Spinner />}><ConsultingContent /></Suspense>
      </ConsultingGate>
    </div>
  );
}
