// app/(dashboard)/consulting/components/sections/CompetitorsSection.tsx
// 03 경쟁 — 기존 GEO(AI 가시성) 실제 근거만 재사용한다.
// SERP organic 경쟁 도메인 자료가 없으면 items=null → "준비 필요"로 degrade(설계 §3.3-03).
// 프론트는 커버리지·점유율을 추정하지 않는다 — 서버가 준 관측값만 표시.
'use client';

import type { CompetitorsSection as CompetitorsSectionDTO, EvidenceRef } from '../../types';
import { formatMetric } from '../../constants';
import { SectionShell } from './SectionShell';
import { EvidenceDetails } from './EvidenceDetails';

const ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
  </svg>
);

export function CompetitorsSection({ section, evidenceById }: { section: CompetitorsSectionDTO; evidenceById: Map<string, EvidenceRef> }) {
  const items = section.items;
  // items===null 이면 SERP organic 근거 부재 → degrade. 빈 배열도 표시할 수치가 없으므로 degrade.
  const hasItems = Array.isArray(items) && items.length > 0;
  const evidenceIds = (items ?? []).map((c) => c.evidenceId);
  return (
    <SectionShell title="경쟁 현황" icon={ICON} meta={section.meta} forceDegraded={!hasItems}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {(items ?? []).map((c, i) => (
          <div key={`${c.name}:${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: '#2a7d5f', background: 'var(--green-100)', borderRadius: 5, padding: '2px 6px' }}>GEO</span>
            <span style={{ fontSize: 12, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
            <span style={{ fontSize: 10.5, color: 'var(--sub)' }}>{c.metric}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', minWidth: 56, textAlign: 'right' }}>{formatMetric(c.value)}</span>
          </div>
        ))}
      </div>
      <EvidenceDetails ids={evidenceIds} evidenceById={evidenceById} />
    </SectionShell>
  );
}
