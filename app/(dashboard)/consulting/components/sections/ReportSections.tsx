// app/(dashboard)/consulting/components/sections/ReportSections.tsx
// 구조화 리포트 v2 — 6섹션 조립(표시 순서 §3.3). 조합만 담당하며 수치·집계는 서버 책임.
// 열람 순서: 01 수요추이 → 02 우선순위 → 03 경쟁 → 04 GTM → 05 전체 키워드 → 06 지표 정의.
'use client';

import { useMemo } from 'react';
import type { ConsultingSectionsDTO, EvidenceRef } from '../../types';
import { SummarySection } from './SummarySection';
import { FocusSection } from './FocusSection';
import { CompetitorsSection } from './CompetitorsSection';
import { GtmSection } from './GtmSection';
import { KeywordsSection } from './KeywordsSection';
import { MethodologySection } from './MethodologySection';

interface Props {
  sections: ConsultingSectionsDTO;
  evidenceById: Map<string, EvidenceRef>;
  domainId: string;
}

export function ReportSections({ sections, evidenceById, domainId }: Props) {
  // 02 우선순위는 keywordId 만 가지므로 05 키워드 테이블에서 표시용 라벨을 교차참조한다.
  const labelOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const row of sections.keywords.rows) m.set(row.keywordId, row.keyword);
    return (id: string) => m.get(id) ?? id;
  }, [sections.keywords.rows]);

  return (
    <>
      <SummarySection section={sections.summary} evidenceById={evidenceById} />
      <FocusSection section={sections.focus} labelOf={labelOf} evidenceById={evidenceById} />
      <CompetitorsSection section={sections.competitors} evidenceById={evidenceById} />
      <GtmSection section={sections.gtm} evidenceById={evidenceById} domainId={domainId} />
      <KeywordsSection section={sections.keywords} />
      <MethodologySection section={sections.methodology} />
    </>
  );
}
