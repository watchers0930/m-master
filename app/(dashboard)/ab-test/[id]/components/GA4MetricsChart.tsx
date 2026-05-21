'use client';

// GA4MetricsChart — SVG/CSS 가로 막대그래프 직접 구현
// recharts 미설치 → 추후 도입 시 이 컴포넌트 교체. plan.md §6 참조.

import type { AbTestPathMetrics } from '@/types/db';
import type { AbTestGa4Response } from '@/types/api';

interface Props {
  ga4: AbTestGa4Response | null;
  loading: boolean;
  error: string | null;
  winner: 'a' | 'b' | 'tie' | null;
  onRetry: () => void;
}

const METRICS: { key: keyof AbTestPathMetrics; label: string; isPercent?: boolean; isSeconds?: boolean }[] = [
  { key: 'sessions',               label: '세션' },
  { key: 'screenPageViews',        label: '페이지뷰' },
  { key: 'averageSessionDuration', label: '평균체류(초)', isSeconds: true },
  { key: 'bounceRate',             label: '이탈률(%)',   isPercent: true },
  { key: 'engagementRate',         label: '참여율(%)',   isPercent: true },
];

function formatValue(val: number, isPercent?: boolean, isSeconds?: boolean): string {
  if (isPercent)  return `${(val * 100).toFixed(1)}%`;
  if (isSeconds)  return `${val.toFixed(1)}s`;
  return val.toLocaleString();
}

function diffLabel(a: number, b: number): { text: string; aWins: boolean; tie: boolean } {
  const max = Math.max(a, b, 1);
  const pct = ((a - b) / max) * 100;
  if (Math.abs(pct) < 0.5) return { text: '—', aWins: false, tie: true };
  const sign = pct > 0 ? '+' : '';
  return { text: `${sign}${pct.toFixed(1)}%`, aWins: pct > 0, tie: false };
}

function MetricBar({
  label,
  valA,
  valB,
  isPercent,
  isSeconds,
  winnerVariant,
}: {
  label: string;
  valA: number;
  valB: number;
  isPercent?: boolean;
  isSeconds?: boolean;
  winnerVariant: 'a' | 'b' | 'tie' | null;
}) {
  const max     = Math.max(valA, valB, 1);
  const pctA    = (valA / max) * 100;
  const pctB    = (valB / max) * 100;
  const diff    = diffLabel(valA, valB);

  const aWins   = winnerVariant === 'a' || (!winnerVariant && diff.aWins);
  const bWins   = winnerVariant === 'b' || (!winnerVariant && !diff.aWins && !diff.tie);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
      {/* 메트릭 라벨 + 차이 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--sub)' }}>{label}</span>
        {!diff.tie && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: diff.aWins ? 'var(--green-500)' : 'var(--sub)',
            }}
          >
            {diff.text} (A 기준)
          </span>
        )}
      </div>

      {/* 변형 A 바 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: 'var(--blue-600)',
            color: '#fff',
            fontSize: 9,
            fontWeight: 700,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >A</span>
        <div style={{ flex: 1, height: 14, background: 'var(--n100)', borderRadius: 4, overflow: 'hidden' }}>
          <div
            style={{
              width: `${pctA}%`,
              height: '100%',
              background: '#2563EB',
              borderRadius: 4,
              border: aWins ? '2px solid var(--blue-700)' : 'none',
              transition: 'width 0.5s ease',
            }}
          />
        </div>
        <span style={{ fontSize: 11, color: 'var(--text)', minWidth: 56, textAlign: 'right', fontWeight: aWins ? 700 : 400, fontFamily: "'SCoreDream', 'Paperlogy', sans-serif" }}>
          {formatValue(valA, isPercent, isSeconds)}
        </span>
      </div>

      {/* 변형 B 바 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: 'var(--amber-500)',
            color: '#fff',
            fontSize: 9,
            fontWeight: 700,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >B</span>
        <div style={{ flex: 1, height: 14, background: 'var(--n100)', borderRadius: 4, overflow: 'hidden' }}>
          <div
            style={{
              width: `${pctB}%`,
              height: '100%',
              background: '#B45309',
              borderRadius: 4,
              border: bWins ? '2px solid var(--amber-700)' : 'none',
              transition: 'width 0.5s ease',
            }}
          />
        </div>
        <span style={{ fontSize: 11, color: 'var(--text)', minWidth: 56, textAlign: 'right', fontWeight: bWins ? 700 : 400, fontFamily: "'SCoreDream', 'Paperlogy', sans-serif" }}>
          {formatValue(valB, isPercent, isSeconds)}
        </span>
      </div>
    </div>
  );
}

export default function GA4MetricsChart({ ga4, loading, error, winner, onRetry }: Props) {
  return (
    <div className="card" aria-live="polite">
      <div className="card-head">
        <span className="card-title">GA4 성과 비교</span>
        {ga4?.period && (
          <span style={{ fontSize: 11, color: 'var(--sub)', marginLeft: 'auto' }}>
            측정 기간: {ga4.period.from} ~ {ga4.period.to}
          </span>
        )}
      </div>

      <div style={{ padding: '14px 16px' }}>
        {loading ? (
          /* 스켈레톤 */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {METRICS.map((m) => (
              <div key={m.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ width: 60, height: 12, background: 'var(--n100)', borderRadius: 3, animation: 'pulse 1.5s ease-in-out infinite' }} />
                <div style={{ width: '100%', height: 14, background: 'var(--n100)', borderRadius: 4, animation: 'pulse 1.5s ease-in-out infinite' }} />
                <div style={{ width: '75%', height: 14, background: 'var(--n100)', borderRadius: 4, animation: 'pulse 1.5s ease-in-out infinite' }} />
              </div>
            ))}
            <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }`}</style>
          </div>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: '28px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <p style={{ fontSize: 12, color: '#dc2626' }}>GA4 데이터를 불러오지 못했습니다</p>
            <p style={{ fontSize: 11, color: 'var(--sub)' }}>{error}</p>
            <button type="button" className="btn btn-ghost" onClick={onRetry}>재시도</button>
          </div>
        ) : !ga4 ? (
          <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--sub)', padding: '32px 0' }}>
            아직 측정 데이터가 없습니다
          </p>
        ) : (
          <>
            {/* 범례 */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--sub)' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#2563EB', display: 'inline-block' }} />
                변형 A
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--sub)' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#B45309', display: 'inline-block' }} />
                변형 B
              </span>
            </div>

            {METRICS.map((m) => (
              <MetricBar
                key={m.key}
                label={m.label}
                valA={ga4.variant_a[m.key] ?? 0}
                valB={ga4.variant_b[m.key] ?? 0}
                isPercent={m.isPercent}
                isSeconds={m.isSeconds}
                winnerVariant={winner}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
