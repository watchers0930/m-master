// app/(dashboard)/consulting/components/sections/MethodologySection.tsx
// 06 How It Works — 버전 있는 지표 정의·집계 산식·실제 소스·선택 제한을 표시한다.
// 수집하지 않은 소스를 사용했다고 표기하지 않는다(설계 §3.3-06). 서버가 준 정의만 노출.
'use client';

import type { MethodologySection as MethodologySectionDTO } from '../../types';
import { SectionShell } from './SectionShell';

const ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
    <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-2.82 1.17V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15H4.5a2 2 0 110-4h.09A1.65 1.65 0 006 9.4" />
  </svg>
);

export function MethodologySection({ section }: { section: MethodologySectionDTO }) {
  const hasDefs = section.metricDefs.length > 0;
  return (
    <SectionShell title="지표 정의·방법" icon={ICON} meta={section.meta} forceDegraded={!hasDefs}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {section.metricDefs.map((d) => (
          <div key={d.key} style={{ borderLeft: '3px solid var(--border)', paddingLeft: 10 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{d.key}</span>
              <span style={{ fontSize: 9.5, color: 'var(--sub)', background: 'var(--n100)', borderRadius: 4, padding: '1px 6px' }}>{d.source}</span>
              <span style={{ fontSize: 9.5, color: 'var(--sub)' }}>v{d.version}</span>
            </div>
            <p style={{ fontSize: 11.5, color: 'var(--sub)', lineHeight: 1.6, marginTop: 3 }}>{d.definition}</p>
            {d.formula && (
              <p style={{ fontSize: 10.5, color: 'var(--sub)', marginTop: 2, fontFamily: 'var(--font-mono, monospace)' }}>산식: {d.formula}</p>
            )}
          </div>
        ))}
      </div>

      {section.selectionLimits.filter(Boolean).length > 0 && (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--sub)', marginBottom: 4 }}>선택 제한</p>
          <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {section.selectionLimits.filter(Boolean).map((sel, i) => (
              <li key={i} style={{ fontSize: 10.5, color: 'var(--sub)', lineHeight: 1.6 }}>
                {sel!.rule} — {sel!.selected}/{sel!.total} 선택 (상한 {sel!.limit})
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionShell>
  );
}
