// app/(dashboard)/visibility/components/EngineBreakdown.tsx
// 엔진별 SoV·인용률 요약. 설계 §3.8·§4.5: 표본 0 → '데이터 없음'(0% 금지),
// 실패·미지원·결과없음·판정불가는 분모 제외·별도 건수로 표시.
'use client';

import type { EngineScore } from '@/types/visibility';
import { ENGINE_COLORS, ENGINE_LABELS, formatRate } from '../constants';

function Bar({ rate, color }: { rate: number | null; color: string }) {
  return (
    <div style={{ flex: 1, height: 8, background: 'var(--n100)', borderRadius: 4, overflow: 'hidden' }}>
      <div style={{ width: rate === null ? 0 : `${Math.min(rate * 100, 100)}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.4s ease' }} />
    </div>
  );
}

function EngineRow({ s }: { s: EngineScore }) {
  const color = ENGINE_COLORS[s.engine];
  const extra: string[] = [];
  if (s.failedCount > 0) extra.push(`실패·미지원 ${s.failedCount}`);
  if (s.unresolvableCount > 0) extra.push(`판정불가 ${s.unresolvableCount}`);

  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>{ENGINE_LABELS[s.engine]}</span>
        <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--sub)' }}>
          유효 표본 {s.validSamples}건
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: 10.5, color: 'var(--sub)', width: 56, flexShrink: 0 }}>노출 점유</span>
        <Bar rate={s.sov} color={color} />
        <span style={{ fontSize: 12, fontWeight: 700, color: s.sov === null ? 'var(--sub)' : 'var(--text)', minWidth: 60, textAlign: 'right', fontFamily: "'SCoreDream', 'Paperlogy', sans-serif" }}>
          {s.sov === null ? '데이터 없음' : formatRate(s.sov)}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 10.5, color: 'var(--sub)', width: 56, flexShrink: 0 }}>인용률</span>
        <Bar rate={s.citationRate} color="var(--blue-300)" />
        <span style={{ fontSize: 12, fontWeight: 700, color: s.citationRate === null ? 'var(--sub)' : 'var(--text)', minWidth: 60, textAlign: 'right', fontFamily: "'SCoreDream', 'Paperlogy', sans-serif" }}>
          {s.citationRate === null ? '데이터 없음' : formatRate(s.citationRate)}
        </span>
      </div>

      {extra.length > 0 && (
        <p style={{ fontSize: 10, color: 'var(--sub)', marginTop: 6 }}>{extra.join(' · ')} (분모 제외)</p>
      )}
    </div>
  );
}

export function EngineBreakdown({ engines }: { engines: EngineScore[] }) {
  return (
    <div className="card">
      <div className="card-head">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
          <path d="M18 20V10M12 20V4M6 20v-6" />
        </svg>
        <span className="card-title">엔진별 노출 점유율</span>
      </div>
      {engines.length === 0 ? (
        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--sub)', padding: '32px 0' }}>
          선택한 조건에 수집된 데이터가 없습니다
        </p>
      ) : (
        engines.map((s) => <EngineRow key={s.engine} s={s} />)
      )}
    </div>
  );
}
