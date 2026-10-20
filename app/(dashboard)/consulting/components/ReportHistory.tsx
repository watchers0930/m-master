// app/(dashboard)/consulting/components/ReportHistory.tsx
// 리포트 이력 — cursor 페이지네이션(최신순). 선택 시 상단에 해당 리포트를 표시한다(무과금 조회).
'use client';

import type { ConsultingReportDTO } from '../types';
import { STATUS_META, formatDateTime } from '../constants';

interface Props {
  reports: ConsultingReportDTO[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  fetchingMore: boolean;
  activeId: string | null;
  onSelect: (id: string) => void;
  onLoadMore: () => void;
  onRetry: () => void;
}

export function ReportHistory({ reports, loading, error, hasMore, fetchingMore, activeId, onSelect, onLoadMore, onRetry }: Props) {
  return (
    <div className="card">
      <div className="card-head">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
          <path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 106 5.3L3 8" /><path d="M12 7v5l4 2" />
        </svg>
        <span className="card-title">리포트 이력</span>
      </div>

      <div style={{ padding: '12px 16px' }}>
        {loading ? (
          <p style={{ fontSize: 12, color: 'var(--sub)', textAlign: 'center', padding: '16px 0' }}>불러오는 중…</p>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <p role="alert" style={{ fontSize: 12, color: '#dc2626' }}>{error}</p>
            <button type="button" className="btn btn-ghost" style={{ marginTop: 8 }} onClick={onRetry}>다시 시도</button>
          </div>
        ) : reports.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--sub)', textAlign: 'center', padding: '16px 0' }}>아직 생성된 리포트가 없습니다.</p>
        ) : (
          <>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {reports.map((r) => {
                const meta = STATUS_META[r.status];
                const active = r.id === activeId;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(r.id)}
                      aria-pressed={active}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', cursor: 'pointer',
                        padding: '8px 12px', borderRadius: 7, fontFamily: 'inherit',
                        border: `1px solid ${active ? 'var(--blue-500)' : 'var(--border)'}`,
                        background: active ? 'var(--n100)' : 'var(--surface)',
                      }}
                    >
                      <span style={{ fontSize: 10, fontWeight: 700, color: meta.color, background: meta.bg, borderRadius: 5, padding: '2px 7px', flexShrink: 0 }}>{meta.label}</span>
                      <span style={{ fontSize: 11.5, color: 'var(--text)', flex: 1 }}>{formatDateTime(r.generatedAt ?? r.createdAt)}</span>
                      {r.budgetProposal?.totalAmount != null && (
                        <span style={{ fontSize: 10.5, color: 'var(--sub)' }}>예산 입력됨</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>

            {hasMore && (
              <div style={{ textAlign: 'center', marginTop: 10 }}>
                <button type="button" className="btn btn-ghost" disabled={fetchingMore} onClick={onLoadMore}>
                  {fetchingMore ? '불러오는 중…' : '더 보기'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
