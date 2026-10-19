// app/(dashboard)/visibility/components/CompetitorCompare.tsx
// 경쟁사 언급률 비교. 설계 §4.5: 동일 표본 기준, 합계 100% 불필요(복수 브랜드 공존),
// mentionRate=null 은 '데이터 없음'.
'use client';

import type { CompetitorScore } from '@/types/visibility';
import { formatRate } from '../constants';

function Row({ c }: { c: CompetitorScore }) {
  const pct = c.mentionRate === null ? 0 : Math.min(c.mentionRate * 100, 100);
  return (
    <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {c.label}
        </span>
        {c.cited && (
          <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--blue-600)', background: 'var(--blue-100)', borderRadius: 4, padding: '1px 6px' }}>
            인용됨
          </span>
        )}
        <span style={{ fontSize: 12, fontWeight: 700, color: c.mentionRate === null ? 'var(--sub)' : 'var(--text)', minWidth: 56, textAlign: 'right', fontFamily: "'SCoreDream', 'Paperlogy', sans-serif" }}>
          {c.mentionRate === null ? '—' : formatRate(c.mentionRate)}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, height: 7, background: 'var(--n100)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--amber-500)', borderRadius: 4, transition: 'width 0.4s ease' }} />
        </div>
        <span style={{ fontSize: 10, color: 'var(--sub)', minWidth: 46, textAlign: 'right' }}>언급 {c.mentionedCount}회</span>
      </div>
    </div>
  );
}

export function CompetitorCompare({ competitors }: { competitors: CompetitorScore[] }) {
  return (
    <div className="card">
      <div className="card-head">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
        </svg>
        <span className="card-title">경쟁사 언급 비교</span>
      </div>
      {competitors.length === 0 ? (
        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--sub)', padding: '32px 0' }}>
          경쟁사 언급 데이터가 없습니다
        </p>
      ) : (
        competitors.map((c) => <Row key={c.label} c={c} />)
      )}
    </div>
  );
}
