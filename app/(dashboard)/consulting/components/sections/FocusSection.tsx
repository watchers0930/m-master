// app/(dashboard)/consulting/components/sections/FocusSection.tsx
// 02 우선순위 — 관측 지표(difficulty/volume/cpc/adCompetition/adValue)만 표시한다.
// 종합 점수·4분면 임계값·성장 전망은 서버가 생성하지 않으므로 프론트도 만들지 않는다(설계 §3.3-02).
// adValue 는 서버 계산 참고값(volume×cpc)이며 실광고비·매출·ROAS 가 아니다.
'use client';

import type { EvidenceRef, FocusSection as FocusSectionDTO, Currency } from '../../types';
import { formatDate, formatMetric, formatAdCompetition, formatCurrencyMetric } from '../../constants';
import { SectionShell } from './SectionShell';
import { EvidenceDetails } from './EvidenceDetails';

const ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
    <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />
  </svg>
);

interface Props {
  section: FocusSectionDTO;
  /** keywordId → 키워드 문자열 (05 테이블에서 교차참조, 없으면 id 축약) */
  labelOf: (keywordId: string) => string;
  evidenceById: Map<string, EvidenceRef>;
}

export function FocusSection({ section, labelOf, evidenceById }: Props) {
  const currency: Currency | null = section.meta.currency;
  const hasItems = section.items.length > 0;
  return (
    <SectionShell title="우선순위 키워드" icon={ICON} meta={section.meta} forceDegraded={!hasItems}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {section.items.map((it) => (
          <div key={it.keywordId} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
            <p style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>{labelOf(it.keywordId)}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
              <Metric period={it.metricPeriods?.volume} label="검색량" value={formatMetric(it.volume)} />
              <Metric label="난이도" value={formatMetric(it.difficulty, { suffix: it.difficulty === null ? '' : ' / 100' })} />
              <Metric period={it.metricPeriods?.cpc} label="CPC" value={formatCurrencyMetric(it.cpc, currency)} />
              <Metric period={it.metricPeriods?.adCompetition} label="광고 경쟁도" value={formatAdCompetition(it.adCompetition)} />
              <Metric period={it.metricPeriods?.adValue} label="참고 가치(검색량×CPC)" value={formatCurrencyMetric(it.adValue, currency)} />
            </div>
            <EvidenceDetails ids={it.evidenceIds} evidenceById={evidenceById} />
          </div>
        ))}
      </div>
    </SectionShell>
  );
}

function Metric({ label, value, period }: { label: string; value: string; period?: {from:string;to:string} }) {
  return (
    <div style={{ minWidth: 92 }}>
      <span style={{ display: 'block', fontSize: 10, color: 'var(--sub)' }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{value}</span>
      {period && <span style={{ display: 'block', fontSize: 10, color: 'var(--sub)' }}>{formatDate(period.from)} ~ {formatDate(period.to)}</span>}
    </div>
  );
}
