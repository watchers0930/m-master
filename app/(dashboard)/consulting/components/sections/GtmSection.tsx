// app/(dashboard)/consulting/components/sections/GtmSection.tsx
// 04 GTM — 기존 검증된 strategyJson(진단·채널 믹스·예산·우선순위 액션)을 재노출한다.
// 신규 LLM 호출·수치 추정 없음(설계 §3.3-04). 기존 Phase 3 카드 컴포넌트를 그대로 재사용한다.
'use client';

import type { GtmSection as GtmSectionDTO, EvidenceRef } from '../../types';
import { SectionShell } from './SectionShell';
import { DiagnosisCard } from '../DiagnosisCard';
import { ChannelMixCard } from '../ChannelMixCard';
import { BudgetProposalCard } from '../BudgetProposalCard';
import { PriorityActionsCard } from '../PriorityActionsCard';

const ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
    <path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><path d="M22 4L12 14.01l-3-3" />
  </svg>
);

interface Props {
  section: GtmSectionDTO;
  evidenceById: Map<string, EvidenceRef>;
  domainId: string;
}

export function GtmSection({ section, evidenceById, domainId }: Props) {
  const s = section.strategy;
  const hasStrategy = !!s && !!(s.diagnosis || s.channelMix?.length || s.budgetProposal || s.priorityActions?.length);
  return (
    <SectionShell title="실행 전략(GTM)" icon={ICON} meta={section.meta} forceDegraded={!hasStrategy}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {s?.diagnosis && <DiagnosisCard diagnosis={s.diagnosis} evidenceById={evidenceById} />}
        {s?.channelMix && s.channelMix.length > 0 && <ChannelMixCard channelMix={s.channelMix} evidenceById={evidenceById} />}
        {s?.budgetProposal && <BudgetProposalCard budget={s.budgetProposal} evidenceById={evidenceById} />}
        {s?.priorityActions && s.priorityActions.length > 0 && (
          <PriorityActionsCard actions={s.priorityActions} evidenceById={evidenceById} domainId={domainId} />
        )}
      </div>
    </SectionShell>
  );
}
