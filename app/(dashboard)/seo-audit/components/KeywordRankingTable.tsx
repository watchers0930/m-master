// app/(dashboard)/seo-audit/components/KeywordRankingTable.tsx
// 저장된 순위 스냅샷 이력 (읽기 전용·무과금). 설계 §5.2·§6.6.
// 직접 SERP(serp)와 Labs 발견(labs)을 source 로 구분. 범위 내 미발견 = rank null(0/101 금지).
// Labs 는 sourceObservedAt(데이터 기준 시각)을, 직접 SERP 는 capturedAt(수집 시각)을 구분 표기.
'use client';

import type { SeoRankingDTO } from '@/types/seo';
import { ENGINE_LABELS, RANK_STATUS_META, SOURCE_LABELS, formatDate, formatDateTime } from '../constants';

interface Props {
  rankings: SeoRankingDTO[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  fetchingMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
}

function RankCell({ r }: { r: SeoRankingDTO }) {
  const meta = RANK_STATUS_META[r.status];
  if (r.status === 'ranked' && r.rank !== null) {
    return (
      <span style={{ fontWeight: 700, color: 'var(--text)' }}>
        {r.rank}
        {r.rankAbsolute !== null && <span style={{ fontSize: 9.5, color: 'var(--sub)', fontWeight: 400 }}> (abs {r.rankAbsolute})</span>}
      </span>
    );
  }
  return <span style={{ fontSize: 10.5, color: meta.color }}>{meta.label}</span>;
}

export function KeywordRankingTable({ rankings, loading, error, hasMore, fetchingMore, onLoadMore, onRetry }: Props) {
  return (
    <div className="card">
      <div className="card-head">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
          <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
        <span className="card-title">순위 스냅샷 이력</span>
        <span style={{ fontSize: 10, color: 'var(--sub)' }}>{rankings.length}건</span>
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
      ) : rankings.length === 0 ? (
        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--sub)', padding: '36px 20px' }}>
          저장된 순위 스냅샷이 없습니다. 키워드를 선택해 순위를 갱신하면 이력이 쌓입니다.
        </p>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--sub)', fontSize: 10 }}>
                  <th style={{ padding: '8px 16px' }}>키워드</th>
                  <th style={{ padding: '8px 8px' }}>엔진</th>
                  <th style={{ padding: '8px 8px' }}>기기</th>
                  <th style={{ padding: '8px 8px', textAlign: 'right' }}>순위</th>
                  <th style={{ padding: '8px 8px', textAlign: 'right' }}>범위</th>
                  <th style={{ padding: '8px 8px' }}>출처</th>
                  <th style={{ padding: '8px 16px' }}>시점</th>
                </tr>
              </thead>
              <tbody>
                {rankings.map((r) => (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--border2)' }}>
                    <td style={{ padding: '8px 16px', color: 'var(--text)', fontWeight: 600, maxWidth: 200, wordBreak: 'break-word' }}>{r.keyword}</td>
                    <td style={{ padding: '8px 8px', color: 'var(--sub)' }}>{ENGINE_LABELS[r.engine]}</td>
                    <td style={{ padding: '8px 8px', color: 'var(--sub)' }}>{r.device}</td>
                    <td style={{ padding: '8px 8px', textAlign: 'right' }}><RankCell r={r} /></td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', color: 'var(--sub)' }}>{r.returnedRange ?? '—'}</td>
                    <td style={{ padding: '8px 8px' }}>
                      <span style={{ fontSize: 9.5, fontWeight: 700, color: r.source === 'serp' ? 'var(--blue-400)' : 'var(--sub)', background: 'var(--n100)', borderRadius: 4, padding: '2px 6px' }}>
                        {SOURCE_LABELS[r.source]}
                      </span>
                    </td>
                    <td style={{ padding: '8px 16px', color: 'var(--sub)', fontSize: 10.5 }} title={r.source === 'labs' && r.sourceObservedAt ? `Labs 기준 ${formatDateTime(r.sourceObservedAt)}` : `수집 ${formatDateTime(r.capturedAt)}`}>
                      {r.source === 'labs' && r.sourceObservedAt
                        ? `${formatDate(r.sourceObservedAt)} (Labs 기준)`
                        : formatDate(r.capturedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasMore && (
            <div style={{ padding: '10px 16px', textAlign: 'center', borderTop: '1px solid var(--border2)' }}>
              <button type="button" className="btn btn-ghost" disabled={fetchingMore} onClick={onLoadMore}>
                {fetchingMore ? '불러오는 중…' : '더 보기'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
