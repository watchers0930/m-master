// app/(dashboard)/visibility/components/CitationSources.tsx
// 인용 소스 목록. isOwnDomain(자사) 강조, 엔진·수집시각·순서 표시. 외부 링크는 안전 속성.
'use client';

import type { CitationItem } from '@/types/visibility';
import { ENGINE_LABELS } from '../constants';

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function Row({ c }: { c: CitationItem }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--border2)' }}>
      <span style={{ width: 20, height: 20, borderRadius: 5, flexShrink: 0, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', background: c.isOwnDomain ? 'var(--blue-600)' : 'var(--n100)', color: c.isOwnDomain ? '#fff' : 'var(--sub)' }}>
        {c.position}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {c.title || hostOf(c.url)}
          </span>
          {c.isOwnDomain && (
            <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--blue-600)', background: 'var(--blue-100)', borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>자사</span>
          )}
        </div>
        <a href={c.url} target="_blank" rel="noopener noreferrer nofollow" style={{ fontSize: 10.5, color: 'var(--blue-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
          {c.url}
        </a>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 10, color: 'var(--sub)' }}>{ENGINE_LABELS[c.engine]}</div>
        <div style={{ fontSize: 9.5, color: 'var(--sub)' }}>{c.capturedAt.slice(0, 10)}</div>
      </div>
    </div>
  );
}

export function CitationSources({ citations }: { citations: CitationItem[] }) {
  return (
    <div className="card">
      <div className="card-head">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
          <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
        </svg>
        <span className="card-title">인용 소스</span>
        <span style={{ fontSize: 10, color: 'var(--sub)' }}>{citations.length}건</span>
      </div>
      {citations.length === 0 ? (
        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--sub)', padding: '32px 0' }}>
          인용된 소스가 없습니다
        </p>
      ) : (
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          {citations.map((c, i) => (
            <Row key={`${c.url}-${c.engine}-${i}`} c={c} />
          ))}
        </div>
      )}
    </div>
  );
}
