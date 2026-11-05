'use client';

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarView } from './CalendarView';
import { listSlots, autoSchedule, applyAiProposals, clearSlots, scheduleErrorText } from '@/lib/api/schedule';
import type { AiProposal, AutoScheduleResult } from '@/lib/api/schedule';
import type { ScheduleSlot } from '@/types/db';

const CH_LABEL: Record<string, string> = { blog: '블로그', instagram: '인스타', facebook: '페이스북' };

export default function SchedulerPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const qc = useQueryClient();
  const slotsKey = ['schedule', 'slots', year, month] as const;
  const { data: slots = [], isPending: loading } = useQuery<ScheduleSlot[]>({
    queryKey: slotsKey,
    queryFn: async () => {
      const res = await listSlots({ year, month });
      return res.data ?? [];
    },
  });
  const setSlots = (next: ScheduleSlot[] | ((prev: ScheduleSlot[]) => ScheduleSlot[])) => {
    qc.setQueryData<ScheduleSlot[]>(slotsKey, (prev = []) =>
      typeof next === 'function' ? (next as (p: ScheduleSlot[]) => ScheduleSlot[])(prev) : next,
    );
  };

  // AI 자동편성 모달 상태
  const [aiOpen, setAiOpen] = useState(false);
  const [aiState, setAiState] = useState<'idle' | 'analyzing' | 'done' | 'applying'>('idle');
  const [proposals, setProposals] = useState<AiProposal[]>([]);
  const [ga4Warning, setGa4Warning] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const goPrev = () => {
    if (month === 1) { setYear((y) => y - 1); setMonth(12); }
    else setMonth((m) => m - 1);
  };
  const goNext = () => {
    if (month === 12) { setYear((y) => y + 1); setMonth(1); }
    else setMonth((m) => m + 1);
  };

  const scheduledCount = slots.filter((s) => s.status === 'scheduled').length;
  const publishedCount = slots.filter((s) => s.status === 'published').length;

  // 모달을 닫거나 다시 연 뒤 늦게 도착한 이전 분석 결과가 화면을 덮지 않도록 실행 번호로 구분한다
  const aiRunRef = useRef(0);
  // 편성 적용 요청 — 취소 시 중단(서버도 같은 슬롯은 멱등 skip). 진행 중엔 재분석·재적용을 막는다.
  const applyAbortRef = useRef<AbortController | null>(null);
  const [applyPending, setApplyPending] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  const handleAiOpen = async () => {
    if (applyPending) return;
    const run = ++aiRunRef.current;
    setAiOpen(true);
    setAiState('analyzing');
    setProposals([]);
    setGa4Warning(null);
    setAiError(null);
    try {
      const res = await autoSchedule(year, month, slots);
      if (run !== aiRunRef.current) return;
      const result = res.data as AutoScheduleResult | null;
      setProposals(result?.proposals ?? []);
      if (result?.ga4Fallback) setGa4Warning(result.ga4Error ?? 'GA4 데이터를 가져올 수 없습니다');
    } catch (e) {
      if (run !== aiRunRef.current) return;
      setProposals([]);
      setAiError(e instanceof Error && e.message ? e.message : '자동편성 분석에 실패했습니다');
    } finally {
      // 성공·실패 모두 분석 상태를 끝낸다 (예외 시 'analyzing' 에 멈추지 않게)
      if (run === aiRunRef.current) setAiState('done');
    }
  };

  const handleAiApply = async () => {
    if (applyAbortRef.current) return; // 중복 클릭·재적용 차단
    const run = aiRunRef.current;
    const controller = new AbortController();
    applyAbortRef.current = controller;
    setApplyPending(true);
    setAiState('applying');
    setAiError(null);
    try {
      const res = await applyAiProposals(proposals, controller.signal);
      if (res.error) throw new Error(scheduleErrorText(res.error, '편성 적용에 실패했습니다'));
      if (run !== aiRunRef.current) return;
      setAiOpen(false);
      setAiState('idle');
      setGa4Warning(null);
    } catch (e) {
      if (run !== aiRunRef.current || controller.signal.aborted) return;
      setAiError(e instanceof Error && e.message ? e.message : '편성 적용에 실패했습니다');
      setAiState('done');
    } finally {
      if (applyAbortRef.current === controller) applyAbortRef.current = null;
      setApplyPending(false);
      // 성공·실패·취소 모두 서버 기준으로 다시 읽는다 (취소 전에 서버가 저장했을 수 있음)
      void qc.invalidateQueries({ queryKey: ['schedule', 'slots'] });
    }
  };

  const handleAiClose = () => {
    applyAbortRef.current?.abort();
    aiRunRef.current++;
    setAiOpen(false); setAiState('idle'); setProposals([]); setGa4Warning(null); setAiError(null);
  };

  const [clearing, setClearing] = useState(false);
  const handleClear = async () => {
    if (!window.confirm(`${year}년 ${month}월 슬롯을 모두 삭제할까요?`)) return;
    setClearing(true);
    setPageError(null);
    try {
      const res = await clearSlots(year, month);
      if (res?.error) throw new Error(scheduleErrorText(res.error, '초기화에 실패했습니다'));
      setSlots([]);
    } catch (e) {
      setPageError(e instanceof Error && e.message ? e.message : '초기화에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setClearing(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 1100, flex: 1, minHeight: 0 }}>

      {/* 타이틀 */}
      <div>
        <h1 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>스케줄러</h1>
        <p style={{ fontSize: 12, color: 'var(--sub)', marginTop: 2 }}>날짜를 클릭해 발행 슬롯을 추가하세요</p>
      </div>

      {/* 컨트롤 한 줄: [< 날짜 > | AI자동편성 | 초기화] [예약 | 완료 | 총N건] */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>

        {/* 좌측: 월이동 · AI자동편성 · 초기화 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={goPrev} className="btn btn-ghost" style={{ padding: '5px 10px', fontSize: 16 }}>‹</button>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue-700)', minWidth: 90, textAlign: 'center' }}>{year}년 {month}월</span>
          <button onClick={goNext} className="btn btn-ghost" style={{ padding: '5px 10px', fontSize: 16 }}>›</button>
          <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 4px' }} />
          <button onClick={handleAiOpen} disabled={applyPending} title={applyPending ? '편성 적용 중입니다' : undefined} className="btn btn-teal" style={{ fontSize: 11, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 5, opacity: applyPending ? 0.6 : 1 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/>
            </svg>
            AI 자동편성
          </button>
          <button onClick={handleClear} disabled={clearing || slots.length === 0} className="btn btn-ghost" style={{ fontSize: 11, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 5, color: 'var(--red, #dc2626)', opacity: slots.length === 0 ? 0.4 : 1 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
            </svg>
            {clearing ? '삭제 중...' : '초기화'}
          </button>
        </div>

        {/* 우측: 예약 · 발행완료 · 총N건 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'var(--blue-50)', border: '1px solid var(--blue-200)', borderRadius: 8, padding: '4px 10px', fontSize: 11, color: 'var(--blue-600)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--blue-400)', display: 'inline-block' }} />
            예약 {scheduledCount}건
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'var(--green-100)', border: '1px solid #bbf7d0', borderRadius: 8, padding: '4px 10px', fontSize: 11, color: 'var(--green-700)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green-500)', display: 'inline-block' }} />
            발행 완료 {publishedCount}건
          </div>
          <span style={{ fontSize: 11, color: 'var(--sub)' }}>총 {slots.length}건</span>
        </div>
      </div>

      {pageError && <p role="alert" style={{ fontSize: 12, color: '#dc2626', margin: 0 }}>{pageError}</p>}

      {/* 캘린더 카드 */}
      <div className="card" style={{ flex: 1, minHeight: 0 }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--blue-400)" strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
              <path d="M21 12a9 9 0 11-6.219-8.56"/>
            </svg>
          </div>
        ) : (
          <CalendarView year={year} month={month} slots={slots} onSlotsChange={setSlots} />
        )}
      </div>

      <p style={{ fontSize: 11, color: 'var(--sub)' }}>날짜 클릭 → 슬롯 추가 모달 · 슬롯의 × 클릭 → 삭제 · 드래그 이동은 Phase 2에서 지원됩니다.</p>

      {/* AI 자동편성 모달 */}
      {aiOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={handleAiClose}>
          <div style={{ background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', width: 420, boxShadow: '0 12px 40px rgba(0,0,0,0.15)' }} onClick={(e) => e.stopPropagation()}>

            {/* 헤더 */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="1.8" strokeLinecap="round">
                <polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/>
              </svg>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', flex: 1 }}>AI 자동편성 — {year}년 {month}월</span>
              <button onClick={handleAiClose} style={{ background: 'none', border: 'none', fontSize: 20, color: 'var(--sub)', cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>

            {/* 본문 */}
            <div style={{ padding: '20px' }}>
              {/* GA4 실패 경고 배너 */}
              {ga4Warning && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#b45309" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}>
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                  <div role="status">
                    <p style={{ fontSize: 12, fontWeight: 600, color: '#92400e', marginBottom: 2 }}>GA4 방문자 패턴을 사용할 수 없습니다</p>
                    <p style={{ fontSize: 11, color: '#b45309' }}>{ga4Warning}</p>
                  </div>
                </div>
              )}

              {aiState === 'analyzing' && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '24px 0' }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
                    <path d="M21 12a9 9 0 11-6.219-8.56"/>
                  </svg>
                  <p style={{ fontSize: 13, color: 'var(--sub)' }}>GA4 트렌드 + 시즌 데이터 분석 중...</p>
                </div>
              )}

              {aiError && (
                <p role="alert" style={{ fontSize: 12, color: '#dc2626', textAlign: 'center', padding: '12px 0' }}>{aiError}</p>
              )}

              {aiState === 'done' && proposals.length === 0 && !aiError && (
                <p style={{ fontSize: 13, color: 'var(--sub)', textAlign: 'center', padding: '24px 0' }}>
                  {ga4Warning
                    ? 'GA4 데이터 미수집으로 자동편성을 건너뜁니다. GA4 연결 확인 후 재시도하세요.'
                    : '이번 달에 추가할 수 있는 빈 날짜가 없습니다.'}
                </p>
              )}

              {(aiState === 'done' || aiState === 'applying') && proposals.length > 0 && (
                <>
                  <p style={{ fontSize: 12, color: 'var(--sub)', marginBottom: 14 }}>
                    GA4 방문자 패턴과 시즌 분석을 기반으로 최적 날짜 {proposals.length}건을 제안합니다.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 380, overflowY: 'auto' }}>
                    {proposals.map((p, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--blue-50)', border: '1px solid var(--blue-200)', borderRadius: 8, padding: '10px 14px' }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--blue-400)" strokeWidth="1.8" strokeLinecap="round">
                          <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
                        </svg>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', flex: 1 }}>{p.date}</span>
                        <span style={{ fontSize: 11, color: 'var(--blue-600)', background: 'var(--blue-100)', border: '1px solid var(--blue-200)', borderRadius: 5, padding: '2px 8px' }}>{CH_LABEL[p.channel]}</span>
                        <span style={{ fontSize: 11, color: 'var(--sub)' }}>{p.time}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* 푸터 */}
            {(aiState === 'done' || aiState === 'applying') && proposals.length > 0 && (
              <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button onClick={handleAiClose} className="btn btn-ghost" style={{ fontSize: 12 }}>취소</button>
                <button onClick={handleAiApply} disabled={aiState === 'applying'} className="btn btn-teal" style={{ fontSize: 12, opacity: aiState === 'applying' ? 0.7 : 1 }}>
                  {aiState === 'applying' ? '편성 중...' : '편성 적용'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
