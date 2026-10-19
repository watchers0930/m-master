// app/(dashboard)/visibility/components/SovTrendChart.tsx
// SoV·인용률 추세 (SVG 라인). recharts 미설치 → 직접 그린다(기존 GA4MetricsChart 선례).
// x좌표는 배열 인덱스가 아니라 실제 날짜에 비례해 배치한다(MED6). 조회 기간(from~to)을
//   도메인으로 삼아 관측일이 기간 내 어디에 있는지 정직하게 보여준다.
// 선 끊기: ① sov=null(표본 0) 구간은 점을 찍지 않고 선을 끊는다.
//   ② 응답에 아예 없는 미수집 구간(장기 공백)도 연속 추세로 오독하지 않도록,
//      직전 관측일과의 간격이 MAX_GAP_DAYS 를 넘으면 선을 끊는다.
'use client';

import type { TrendPoint } from '@/types/visibility';
import { formatRate } from '../constants';

const W = 640;
const H = 180;
const PAD = { top: 16, right: 16, bottom: 26, left: 34 };
const DAY = 86400000;
/** 직전 관측일과 이 일수를 초과해 벌어지면 선을 끊는다(장기 미수집 구간). */
const MAX_GAP_DAYS = 8;

interface SeriesDef {
  key: 'sov' | 'citationRate';
  label: string;
  color: string;
}

const SERIES: SeriesDef[] = [
  { key: 'sov', label: '노출 점유(SoV)', color: '#1b356f' },
  { key: 'citationRate', label: '인용률', color: '#6f8fd0' },
];

/** 'YYYY-MM-DD' → epoch(ms, UTC 자정). 파싱 불가 시 NaN. */
function dayMs(date: string): number {
  return Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
}

export function SovTrendChart({ trend, from, to }: { trend: TrendPoint[]; from?: string; to?: string }) {
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  // 날짜 오름차순 정렬(서버가 정렬해 주지만 방어적으로).
  const points = [...trend].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const hasAny = points.some((p) => p.sov !== null || p.citationRate !== null);

  // x축 도메인: from~to 우선, 없거나 유효하지 않으면 관측일 최소~최대로 대체.
  const firstMs = points.length ? dayMs(points[0].date) : NaN;
  const lastMs = points.length ? dayMs(points[points.length - 1].date) : NaN;
  const fromMs = from ? dayMs(from) : NaN;
  const toMs = to ? dayMs(to) : NaN;
  const t0 = Number.isFinite(fromMs) ? fromMs : firstMs;
  const t1 = Number.isFinite(toMs) ? toMs : lastMs;
  const span = Number.isFinite(t0) && Number.isFinite(t1) ? t1 - t0 : NaN;

  // 날짜 비례 x. 도메인 폭이 0 이하이거나 파싱 불가하면 인덱스 균등 배치로 안전하게 대체.
  const xOf = (i: number): number => {
    if (!Number.isFinite(span) || span <= 0) {
      const n = points.length;
      return PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    }
    const t = dayMs(points[i].date);
    if (!Number.isFinite(t)) return PAD.left;
    const ratio = Math.min(1, Math.max(0, (t - t0) / span));
    return PAD.left + ratio * innerW;
  };

  const yOf = (v: number): number => PAD.top + innerH - v * innerH; // v: 0~1

  const buildPath = (key: SeriesDef['key']): string => {
    let d = '';
    let penDown = false;
    let prevMs = NaN;
    points.forEach((p, i) => {
      const v = p[key];
      if (v === null || v === undefined) {
        penDown = false; // 명시적 결측(표본 0) → 선 끊기
        prevMs = NaN;
        return;
      }
      const curMs = dayMs(p.date);
      const gapTooBig =
        penDown && Number.isFinite(prevMs) && Number.isFinite(curMs) && curMs - prevMs > MAX_GAP_DAYS * DAY;
      const cmd = penDown && !gapTooBig ? 'L' : 'M'; // 장기 공백이면 잇지 않고 새로 시작
      d += `${cmd}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)} `;
      penDown = true;
      prevMs = curMs;
    });
    return d.trim();
  };

  // x축 라벨: 도메인 양끝(from~to, 없으면 관측 최소~최대)
  const leftLabel = (Number.isFinite(fromMs) ? from : points[0]?.date)?.slice(5);
  const rightLabel = (Number.isFinite(toMs) ? to : points[points.length - 1]?.date)?.slice(5);

  return (
    <div className="card">
      <div className="card-head">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
          <path d="M3 3v18h18" /><path d="M7 14l4-4 3 3 5-6" />
        </svg>
        <span className="card-title">노출·인용 추세</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 12 }}>
          {SERIES.map((s) => (
            <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--sub)' }}>
              <span style={{ width: 10, height: 3, borderRadius: 2, background: s.color, display: 'inline-block' }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>

      <div style={{ padding: '14px 16px' }}>
        {!hasAny ? (
          <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--sub)', padding: '40px 0' }}>
            추세를 표시할 유효 표본이 없습니다
          </p>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="노출·인용 추세 차트">
            {/* y축 가이드 (0/50/100%) */}
            {[0, 0.5, 1].map((g) => {
              const gy = PAD.top + innerH - g * innerH;
              return (
                <g key={g}>
                  <line x1={PAD.left} y1={gy} x2={W - PAD.right} y2={gy} stroke="var(--border)" strokeWidth={1} />
                  <text x={PAD.left - 6} y={gy + 3} textAnchor="end" fontSize={9} fill="var(--sub)">
                    {g * 100}%
                  </text>
                </g>
              );
            })}
            {/* 데이터 라인 */}
            {SERIES.map((s) => (
              <path key={s.key} d={buildPath(s.key)} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            ))}
            {/* 데이터 포인트 */}
            {SERIES.map((s) =>
              points.map((p, i) => {
                const v = p[s.key];
                if (v === null || v === undefined) return null;
                return <circle key={`${s.key}-${i}`} cx={xOf(i)} cy={yOf(v)} r={2.5} fill={s.color} />;
              }),
            )}
            {/* x축 라벨 (양끝만 — 과밀 방지) */}
            {points.length > 0 && (
              <>
                <text x={PAD.left} y={H - 8} textAnchor="start" fontSize={9} fill="var(--sub)">
                  {leftLabel}
                </text>
                <text x={W - PAD.right} y={H - 8} textAnchor="end" fontSize={9} fill="var(--sub)">
                  {rightLabel}
                </text>
              </>
            )}
          </svg>
        )}
        {hasAny && (
          <p style={{ fontSize: 10, color: 'var(--sub)', marginTop: 6, textAlign: 'right' }}>
            최신 SoV {formatRate(points[points.length - 1]?.sov ?? null)} · 표본 {points[points.length - 1]?.validSamples ?? 0}건
          </p>
        )}
      </div>
    </div>
  );
}
