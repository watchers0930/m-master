'use client';

// 채널×요일 히트맵 (B 단계)
// GET /api/analytics/ga4-pattern → Ga4Block<DowChannelRow[]> (설계 §4.7). 집계는 dow-pattern.ts(순수).
// GA4 실패·미연결이면 0 행렬 대신 상태 안내를 표시한다(설계 §2.4).

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchDowPattern } from '../api';
import { aggregateDowPattern, type PatternChannel } from '../dow-pattern';
import { Ga4BlockState } from '@/components/ga4/Ga4BlockState';

const DOW_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
const CHANNELS: Array<{ key: PatternChannel; label: string; color: string }> = [
  { key: 'blog',      label: '블로그',   color: '37, 99, 235' },   // blue-600
  { key: 'instagram', label: '인스타',   color: '217, 70, 239' },  // fuchsia-500
  { key: 'facebook',  label: '페이스북', color: '24, 119, 242' },  // facebook
];

function cellBg(value: number, max: number, rgb: string): string {
  if (max <= 0 || value <= 0) return 'var(--n50)';
  const intensity = Math.min(1, Math.max(0.1, value / max));
  return `rgba(${rgb}, ${intensity * 0.85 + 0.05})`;
}

function cellText(value: number, max: number): string {
  if (max <= 0 || value / max < 0.5) return 'var(--text)';
  return '#fff';
}

function HeatmapTable({ agg }: { agg: ReturnType<typeof aggregateDowPattern> }) {
  const { matrix, pattern, totals } = agg;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 2, fontSize: 11 }}>
        <thead>
          <tr>
            <th style={{ width: 84, textAlign: 'left', padding: '4px 8px', color: 'var(--sub)', fontWeight: 600 }}>채널</th>
            {DOW_LABELS.map((d, i) => (
              <th key={d} style={{
                textAlign: 'center',
                padding: '4px 0',
                fontWeight: 600,
                color: (i === 0 || i === 6) ? '#dc2626' : 'var(--sub)',
              }}>{d}</th>
            ))}
            <th style={{ textAlign: 'right', padding: '4px 8px', color: 'var(--sub)', fontWeight: 600, width: 80 }}>90일 합</th>
          </tr>
        </thead>
        <tbody>
          {CHANNELS.map((ch) => {
            const row = matrix[ch.key];
            const max = Math.max(1, ...row);
            const total = totals[ch.key];
            const topDows = new Set(pattern[ch.key]);
            return (
              <tr key={ch.key}>
                <td style={{ padding: '4px 8px', fontWeight: 600, color: `rgb(${ch.color})` }}>
                  {ch.label}
                </td>
                {row.map((v, i) => {
                  const isTop = topDows.has(i);
                  return (
                    <td key={i} style={{
                      textAlign: 'center',
                      padding: '8px 0',
                      fontWeight: 600,
                      fontSize: 11,
                      background: cellBg(v, max, ch.color),
                      color: cellText(v, max),
                      borderRadius: 3,
                      border: isTop ? `1.5px solid rgb(${ch.color})` : '1.5px solid transparent',
                    }}>
                      {v > 0 ? v.toLocaleString() : '-'}
                    </td>
                  );
                })}
                <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--text)', fontWeight: 600 }}>
                  {total.toLocaleString()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p style={{ fontSize: 10, color: 'var(--sub)', marginTop: 8 }}>
        테두리가 있는 셀: 해당 채널의 상위 요일 (스케줄러 자동편성에 사용됨)
      </p>
    </div>
  );
}

export function DowHeatmap({ domainId }: { domainId: string | null }) {
  const { data: block, isPending: loading, error, refetch } = useQuery({
    queryKey: ['analytics', 'ga4-pattern', domainId ?? 'default'],
    queryFn: ({ signal }) => fetchDowPattern(domainId, signal),
    retry: false,
  });
  const agg = useMemo(() => (block?.state === 'ok' ? aggregateDowPattern(block.data) : null), [block]);

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>채널 × 요일 패턴</h2>
        <p style={{ fontSize: 11, color: 'var(--sub)', marginTop: 2 }}>
          최근 90일 GA4 세션 수 · 진할수록 사용자 유입이 많은 요일
        </p>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', fontSize: 12, color: 'var(--sub)' }}>로딩 중...</div>
      ) : error ? (
        <div role="alert" style={{ padding: 40, textAlign: 'center', fontSize: 12, color: '#dc2626' }}>패턴을 불러오지 못했습니다 — {error.message}</div>
      ) : block && block.state !== 'ok' ? (
        <Ga4BlockState block={block} onRetry={() => { void refetch(); }} />
      ) : agg ? <HeatmapTable agg={agg} /> : null}
    </div>
  );
}
