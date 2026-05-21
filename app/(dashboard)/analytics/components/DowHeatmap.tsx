'use client';

// 채널×요일 히트맵 (B 단계)
// 기존 /api/analytics/ga4-pattern API를 재사용 — 최근 90일 채널별 요일 세션 합

import { useEffect, useState } from 'react';
import type { DowPattern, ChannelTotals, DowMatrix } from '@/app/api/analytics/ga4-pattern/route';

const DOW_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
const CHANNELS: Array<{ key: 'blog' | 'instagram' | 'facebook'; label: string; color: string }> = [
  { key: 'blog',      label: '블로그',   color: '37, 99, 235' },   // blue-600
  { key: 'instagram', label: '인스타',   color: '217, 70, 239' },  // fuchsia-500
  { key: 'facebook',  label: '페이스북', color: '24, 119, 242' },  // facebook
];

interface ApiResponse {
  data: DowPattern;
  channel_totals: ChannelTotals | null;
  dow_matrix: DowMatrix;
  ga4_fallback: boolean;
  error: string | null;
}

function cellBg(value: number, max: number, rgb: string): string {
  if (max <= 0 || value <= 0) return 'var(--n50)';
  const intensity = Math.min(1, Math.max(0.1, value / max));
  return `rgba(${rgb}, ${intensity * 0.85 + 0.05})`;
}

function cellText(value: number, max: number): string {
  if (max <= 0 || value / max < 0.5) return 'var(--text)';
  return '#fff';
}

export function DowHeatmap() {
  const [matrix, setMatrix] = useState<DowMatrix | null>(null);
  const [pattern, setPattern] = useState<DowPattern | null>(null);
  const [totals, setTotals] = useState<ChannelTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/analytics/ga4-pattern')
      .then((r) => r.json() as Promise<ApiResponse>)
      .then((res) => {
        if (cancelled) return;
        setMatrix(res.dow_matrix);
        setPattern(res.data);
        setTotals(res.channel_totals);
        setFallback(res.ga4_fallback);
        if (res.error) setError(res.error);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>채널 × 요일 패턴</h2>
        <p style={{ fontSize: 11, color: 'var(--sub)', marginTop: 2 }}>
          최근 90일 GA4 세션 수 · 진할수록 사용자 유입이 많은 요일
        </p>
      </div>

      {fallback && (
        <div style={{ background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: 4, padding: '6px 10px', fontSize: 11, color: '#92400e', marginBottom: 8 }}>
          GA4 데이터를 가져올 수 없어 패턴이 표시되지 않습니다 — {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', fontSize: 12, color: 'var(--sub)' }}>로딩 중...</div>
      ) : !matrix ? (
        <div style={{ padding: 40, textAlign: 'center', fontSize: 12, color: 'var(--sub)' }}>데이터 없음</div>
      ) : null}

      {!fallback && !loading && matrix && (
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
                const row = matrix[ch.key] ?? [];
                const max = row.length > 0 ? Math.max(1, ...row) : 1;
                const total = totals?.[ch.key] ?? 0;
                const topDows = new Set(pattern?.[ch.key] ?? []);
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
      )}
    </div>
  );
}
