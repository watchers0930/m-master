// app/(dashboard)/seo-audit/components/AuditHistory.tsx
// 진단 이력 — 같은 기준(market·scope·scoreVersion)으로 과거 실행을 비교(설계 §8).
// 행 선택 시 상단 상세(점수·체크리스트)로 불러오도록 onSelect 로 auditId 를 올린다.
'use client';

import type { SeoAuditDTO } from '@/types/seo';
import { AUDIT_STATUS_META, SCOPE_LABELS, formatDateTime, formatPercent } from '../constants';

interface Props {
  audits: SeoAuditDTO[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  fetchingMore: boolean;
  activeId: string | null;
  onSelect: (id: string) => void;
  onLoadMore: () => void;
  onRetry: () => void;
}

export function AuditHistory({ audits, loading, error, hasMore, fetchingMore, activeId, onSelect, onLoadMore, onRetry }: Props) {
  return (
    <div className="card">
      <div className="card-head">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
          <path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 106 5.3L3 8" /><path d="M12 7v5l4 2" />
        </svg>
        <span className="card-title">진단 이력</span>
        <span style={{ fontSize: 10, color: 'var(--sub)' }}>{audits.length}건</span>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '36px 0' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--blue-400)" strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
            <path d="M21 12a9 9 0 11-6.219-8.56" />
          </svg>
        </div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <p style={{ color: '#dc2626', fontSize: 12.5 }}>{error}</p>
          <button type="button" className="btn btn-ghost" style={{ marginTop: 10 }} onClick={onRetry}>다시 시도</button>
        </div>
      ) : audits.length === 0 ? (
        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--sub)', padding: '36px 20px' }}>
          아직 실행한 진단이 없습니다.
        </p>
      ) : (
        <>
          {audits.map((a) => {
            const meta = AUDIT_STATUS_META[a.status];
            const isActive = a.id === activeId;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => onSelect(a.id)}
                style={{
                  width: '100%', textAlign: 'left', background: isActive ? 'var(--n100)' : 'none', border: 'none',
                  borderBottom: '1px solid var(--border2)', padding: '10px 16px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}
              >
                <span style={{ fontSize: 10, fontWeight: 700, color: meta.color, background: meta.bg, borderRadius: 5, padding: '2px 7px', flexShrink: 0 }}>{meta.label}</span>
                <span style={{ fontSize: 11.5, color: 'var(--text)', fontWeight: 600, flexShrink: 0 }}>{SCOPE_LABELS[a.scope]}</span>
                <span style={{ fontSize: 10.5, color: 'var(--sub)' }}>{formatDateTime(a.createdAt)}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--sub)', flexShrink: 0 }}>
                  {a.technicalScore !== null ? `${a.technicalScore}점` : '점수 없음'}
                  {a.coverage !== null && ` · 커버 ${formatPercent(a.coverage)}`}
                </span>
              </button>
            );
          })}
          {hasMore && (
            <div style={{ padding: '10px 16px', textAlign: 'center' }}>
              <button type="button" className="btn btn-ghost" disabled={fetchingMore} onClick={onLoadMore}>
                {fetchingMore ? '불러오는 중…' : '이력 더 보기'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
