'use client';

// 콘텐츠별 성과 — 발행 목록(DB)은 항상 표시, GA4 경로 지표는 ga4 블록이 ok 일 때만 (설계 §2.5·§4.7).
// GA4 실패 시 지표를 0 으로 채우지 않고 상태 안내 + 지표 칸 '—' 로 둔다.

import { useState } from 'react';
import { useContentPerformance } from '@/hooks/useGa4Analytics';
import { Ga4BlockState } from '@/components/ga4/Ga4BlockState';
import { computePerfTotals, metricsFor, type PerfTotals } from '@/lib/analytics/content-performance-totals';

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
  domainId: string | null;
}

const NA = <span style={{ color: 'var(--sub)' }}>—</span>;

/** 헤더 합계 문구 — 측정 가능한 행 수를 함께 표기("N건 기준"), 측정 불가면 '—' + 사유 */
function totalsText(t: PerfTotals): string {
  if (t.state === 'unavailable') return ' · 합계 —';
  if (t.state === 'no_measurable') return ` · 합계 — (${t.reason})`;
  const nv = t.naver.state === 'unknown'
    ? '—'
    : `${t.naver.sessions.toLocaleString()}${t.naver.ratio !== null ? ` (${(t.naver.ratio * 100).toFixed(1)}%)` : ''}${t.naver.measured !== t.measured ? ` · ${t.naver.measured}건 기준` : ''}`;
  return ` · 합계(${t.measured}건 기준) 세션 ${t.sessions.toLocaleString()} · PV ${t.pageViews.toLocaleString()} · 네이버 유입 ${nv}`;
}

export function ContentPerformanceTable({ days, domainId }: Props) {
  const [channelFilter, setChannelFilter] = useState<'all' | 'blog' | 'naver_cafe' | 'instagram' | 'facebook'>('all');

  const { data, isPending: loading, error: queryError, refetch } = useContentPerformance(days, domainId);
  const rows = data?.data ?? [];
  const period = data?.period ? { from: data.period.from, to: data.period.to } : null;
  const ga4 = data?.ga4 ?? null;
  const naver = data?.naver ?? null;
  const error = queryError ? queryError.message : null;
  const metricsOf = (path: string | null) => metricsFor(ga4, path);
  // 네이버 유입은 별도 블록 — ga4 가 ok 여도 naver 만 실패할 수 있다
  const naverFailed = ga4?.state === 'ok' && naver !== null && naver.state !== 'ok' ? naver : null;

  const filtered = channelFilter === 'all' ? rows : rows.filter((r) => r.channel === channelFilter);

  // 정렬: 세션 내림차순(지표 없는 행은 뒤로) — 기존 서버 정렬을 GA4 블록 기준으로 유지
  const sorted = [...filtered].sort((a, b) => (metricsOf(b.page_path)?.sessions ?? -1) - (metricsOf(a.page_path)?.sessions ?? -1));

  // 합계는 측정 가능한 행만 (모르는 지표를 0 으로 합산하지 않는다)
  const totals = computePerfTotals(filtered, ga4, naver);

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>콘텐츠별 성과</h2>
          <p style={{ fontSize: 11, color: 'var(--sub)', marginTop: 2 }}>
            {period ? `${period.from} ~ ${period.to}` : '-'} · 발행 {filtered.length}건
            {filtered.length > 0 && totalsText(totals)}
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

      {error && (
        <div role="alert" style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 4, padding: '6px 10px', fontSize: 11, color: '#b91c1c', marginBottom: 8 }}>
          성과를 불러오지 못했습니다 — {error}
        </div>
      )}
      {ga4 && ga4.state !== 'ok' && (
        <div style={{ background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: 4, marginBottom: 8 }}>
          <Ga4BlockState block={ga4} onRetry={() => { void refetch(); }} />
          <p style={{ fontSize: 10.5, color: '#92400e', textAlign: 'center', margin: '0 0 8px' }}>발행 목록은 표시되지만 GA4 지표는 비어 있습니다(0 아님).</p>
        </div>
      )}
      {naverFailed && (
        <div style={{ background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: 4, marginBottom: 8 }}>
          <Ga4BlockState block={naverFailed} onRetry={() => { void refetch(); }} />
          <p style={{ fontSize: 10.5, color: '#92400e', textAlign: 'center', margin: '0 0 8px' }}>네이버 유입 지표를 불러오지 못했습니다 — 네이버 유입 칸은 비어 있습니다(0 아님).</p>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', fontSize: 12, color: 'var(--sub)' }}>로딩 중...</div>
      ) : error ? null : filtered.length === 0 ? (
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
              {sorted.map((r) => { const m = metricsOf(r.page_path); return (
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
                    {m ? m.sessions.toLocaleString() : NA}
                  </td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', color: '#03c75a' }}>
                    {m && r.naver_sessions !== null && r.naver_sessions > 0 ? (
                      <>
                        <span style={{ fontWeight: 600 }}>{r.naver_sessions.toLocaleString()}</span>
                        <span style={{ fontSize: 10, color: 'var(--sub)', marginLeft: 4 }}>
                          ({m.sessions > 0 ? ((r.naver_sessions / m.sessions) * 100).toFixed(0) : 0}%)
                        </span>
                      </>
                    ) : m && r.naver_sessions === 0 ? <span style={{ color: 'var(--sub)' }}>-</span> : NA}
                  </td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--text)' }}>
                    {m ? m.screenPageViews.toLocaleString() : NA}
                  </td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--sub)' }}>
                    {m ? fmtDuration(m.averageSessionDuration) : NA}
                  </td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--sub)' }}>
                    {m ? fmtPercent(m.bounceRate) : NA}
                  </td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--sub)' }}>
                    {m ? fmtPercent(m.engagementRate) : NA}
                  </td>
                </tr>
              ); })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
