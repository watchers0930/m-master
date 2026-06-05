'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ContentPerformanceResponse } from '@/app/api/analytics/content-performance/route';

const CH_LABEL: Record<string, string> = {
  blog: '블로그',
  naver_cafe: '카페',
  instagram: '인스타',
  facebook: '페이스북',
};

const CH_COLOR: Record<string, string> = {
  blog: 'var(--blue-600)',
  naver_cafe: '#03c75a',
  instagram: '#d946ef',
  facebook: '#1877f2',
};

function fmtDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDuration(sec: number): string {
  if (sec <= 0) return '-';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m === 0) return `${s}초`;
  return `${m}분 ${s}초`;
}

function fmtPercent(rate: number): string {
  if (rate <= 0) return '-';
  return `${(rate * 100).toFixed(1)}%`;
}

interface Props {
  days: number;
}

export function ContentPerformanceTable({ days }: Props) {
  const [channelFilter, setChannelFilter] = useState<'all' | 'blog' | 'naver_cafe' | 'instagram' | 'facebook'>('all');

  const { data, isPending: loading, error: queryError } = useQuery({
    queryKey: ['analytics', 'content-performance', days],
    queryFn: async (): Promise<ContentPerformanceResponse> => {
      const r = await fetch(`/api/analytics/content-performance?days=${days}`);
      return r.json() as Promise<ContentPerformanceResponse>;
    },
  });
  const rows = data?.data ?? [];
  const period = data?.period ? { from: data.period.from, to: data.period.to } : null;
  const ga4Fallback = data?.ga4_fallback ?? false;
  const error = data?.error ?? (queryError ? queryError.message : null);

  const filtered = channelFilter === 'all' ? rows : rows.filter((r) => r.channel === channelFilter);

  const totals = filtered.reduce(
    (acc, r) => ({
      sessions: acc.sessions + r.metrics.sessions,
      pageViews: acc.pageViews + r.metrics.screenPageViews,
      naverSessions: acc.naverSessions + r.naver_sessions,
    }),
    { sessions: 0, pageViews: 0, naverSessions: 0 },
  );
  const naverPctTotal = totals.sessions > 0 ? (totals.naverSessions / totals.sessions) : 0;

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>콘텐츠별 성과</h2>
          <p style={{ fontSize: 11, color: 'var(--sub)', marginTop: 2 }}>
            {period ? `${period.from} ~ ${period.to}` : '-'} · 발행 {filtered.length}건 · 합계 세션 {totals.sessions.toLocaleString()} · PV {totals.pageViews.toLocaleString()} · 네이버 유입 {totals.naverSessions.toLocaleString()} ({(naverPctTotal * 100).toFixed(1)}%)
          </p>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['all', 'naver_cafe', 'blog', 'instagram', 'facebook'] as const).map((ch) => (
            <button
              key={ch}
              onClick={() => setChannelFilter(ch)}
              style={{
                padding: '4px 8px',
                fontSize: 10.5,
                fontWeight: 600,
                borderRadius: 4,
                border: `1px solid ${channelFilter === ch ? 'var(--blue-600)' : 'var(--n200)'}`,
                background: channelFilter === ch ? 'var(--blue-600)' : '#fff',
                color: channelFilter === ch ? '#fff' : 'var(--text)',
                cursor: 'pointer',
              }}
            >
              {ch === 'all' ? '전체' : CH_LABEL[ch]}
            </button>
          ))}
        </div>
      </div>

      {ga4Fallback && (
        <div style={{ background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: 4, padding: '6px 10px', fontSize: 11, color: '#92400e', marginBottom: 8 }}>
          GA4 데이터를 가져올 수 없어 메트릭이 0으로 표시됩니다 — {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', fontSize: 12, color: 'var(--sub)' }}>로딩 중...</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', fontSize: 12, color: 'var(--sub)' }}>
          {channelFilter === 'all' ? '발행된 콘텐츠가 없습니다.' : `${CH_LABEL[channelFilter]} 채널에 발행된 콘텐츠가 없습니다.`}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
            <thead>
              <tr style={{ background: 'var(--n50)', textAlign: 'left', color: 'var(--sub)' }}>
                <th style={{ padding: '8px 6px', fontWeight: 600 }}>제목</th>
                <th style={{ padding: '8px 6px', fontWeight: 600, width: 70 }}>채널</th>
                <th style={{ padding: '8px 6px', fontWeight: 600, width: 90 }}>발행일</th>
                <th style={{ padding: '8px 6px', fontWeight: 600, width: 70, textAlign: 'right' }}>세션</th>
                <th style={{ padding: '8px 6px', fontWeight: 600, width: 90, textAlign: 'right' }}>네이버 유입</th>
                <th style={{ padding: '8px 6px', fontWeight: 600, width: 70, textAlign: 'right' }}>PV</th>
                <th style={{ padding: '8px 6px', fontWeight: 600, width: 80, textAlign: 'right' }}>평균체류</th>
                <th style={{ padding: '8px 6px', fontWeight: 600, width: 70, textAlign: 'right' }}>이탈률</th>
                <th style={{ padding: '8px 6px', fontWeight: 600, width: 70, textAlign: 'right' }}>참여율</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.content_id} style={{ borderBottom: '1px solid var(--n100)' }}>
                  <td style={{ padding: '8px 6px', color: 'var(--text)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.external_url ? (
                      <a href={r.external_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text)', textDecoration: 'none' }}>
                        {r.title}
                      </a>
                    ) : (
                      <span>{r.title}</span>
                    )}
                  </td>
                  <td style={{ padding: '8px 6px' }}>
                    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 3, background: `${CH_COLOR[r.channel]}15`, color: CH_COLOR[r.channel] }}>
                      {CH_LABEL[r.channel] ?? r.channel}
                    </span>
                  </td>
                  <td style={{ padding: '8px 6px', color: 'var(--sub)' }}>{fmtDate(r.published_at)}</td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 600, color: 'var(--text)' }}>
                    {r.metrics.sessions.toLocaleString()}
                  </td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', color: '#03c75a' }}>
                    {r.naver_sessions > 0 ? (
                      <>
                        <span style={{ fontWeight: 600 }}>{r.naver_sessions.toLocaleString()}</span>
                        <span style={{ fontSize: 10, color: 'var(--sub)', marginLeft: 4 }}>
                          ({r.metrics.sessions > 0 ? ((r.naver_sessions / r.metrics.sessions) * 100).toFixed(0) : 0}%)
                        </span>
                      </>
                    ) : <span style={{ color: 'var(--sub)' }}>-</span>}
                  </td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--text)' }}>
                    {r.metrics.screenPageViews.toLocaleString()}
                  </td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--sub)' }}>
                    {fmtDuration(r.metrics.averageSessionDuration)}
                  </td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--sub)' }}>
                    {fmtPercent(r.metrics.bounceRate)}
                  </td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--sub)' }}>
                    {fmtPercent(r.metrics.engagementRate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
