// app/(dashboard)/consulting/components/sections/SummarySection.tsx
// 01 수요 추이 — 월·지역 검색량 시계열. 서버가 전달한 관측값만 경량 바로 렌더한다.
// 결측 월은 0 으로 채우지 않고 '누락 월'로 분리 표기한다(설계 §3.3-01: 빈 0배열 금지).
// 프론트는 증감·합계를 재계산하지 않는다 — 비교 수치는 서버가 줄 때만 표시.
'use client';

import type { EvidenceRef, SummarySection as SummarySectionDTO } from '../../types';
import { formatMetric, formatYearMonth } from '../../constants';
import { SectionShell } from './SectionShell';
import { EvidenceDetails } from './EvidenceDetails';

const ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
    <path d="M3 3v18h18" /><path d="M7 14l4-4 3 3 5-6" />
  </svg>
);

// plot 영역은 px 로 고정한다 — 바 높이를 % 로 주면 직접 부모(열 컨테이너)에 확정 높이가 없어
// 브라우저가 auto 로 처리하고 모든 바가 minHeight 로 뭉개진다(설계 §3.3-01, 교차검수 지적 2).
const PLOT_PX = 100;

/** 월별 검색량 바 — 최대값 기준 상대 높이를 '고정 plot 영역 안의 px'로 계산. 표시 전용(값은 서버 관측값) */
function DemandBars({ monthly, unit, multiLocation }: { monthly: SummarySectionDTO['monthly']; unit: string | null; multiLocation: boolean }) {
  const max = monthly.reduce((m, p) => Math.max(m, p.volume), 0);
  const u = unit ? ` ${unit}` : '';
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, overflowX: 'auto', paddingBottom: 4 }}>
      {monthly.map((p, i) => {
        // 관측 0 은 양수와 구분 — 양수는 blue 로 1:max 비율(최소 2px), 0 은 gray 베이스라인(2px).
        const isZero = p.volume <= 0;
        const barPx = isZero ? 2 : Math.max(2, Math.round((p.volume / max) * PLOT_PX));
        const ym = formatYearMonth(p.year, p.month);
        return (
          <div key={`${p.location}:${p.year}:${p.month}:${i}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 34 }}>
            <span style={{ fontSize: 9, color: 'var(--sub)' }}>{formatMetric(p.volume)}</span>
            {/* 확정 높이 plot 영역 안에서 flex-end 정렬 — 바 높이 px 가 의도한 차트 높이에 대해 계산된다 */}
            <div style={{ height: PLOT_PX, display: 'flex', alignItems: 'flex-end' }}>
              <div
                title={`${multiLocation ? `지역 ${p.location} · ` : ''}${ym} · ${formatMetric(p.volume)}${u}`}
                style={{ width: 20, height: barPx, background: isZero ? 'var(--border)' : 'var(--blue-400)', borderRadius: '3px 3px 0 0' }}
              />
            </div>
            <span style={{ fontSize: 9, color: 'var(--sub)', whiteSpace: 'nowrap' }}>{ym.slice(2)}</span>
            {/* 같은 월 다른 지역 포인트를 시각적으로 구분(교차검수 지적 4) */}
            {multiLocation && <span style={{ fontSize: 8, color: 'var(--sub)', whiteSpace: 'nowrap' }}>#{p.location}</span>}
          </div>
        );
      })}
    </div>
  );
}

export function SummarySection({ section, evidenceById }: { section: SummarySectionDTO; evidenceById: Map<string, EvidenceRef> }) {
  const hasData = section.monthly.length > 0;
  // 선택 검색량의 부분합 성격을 명시 — 전체 시장규모나 비교 가능한 성장 추이로 해석되지 않게 한다(지적 3).
  const multiLocation = new Set(section.monthly.map((p) => p.location)).size > 1;
  return (
    <SectionShell title="수요 추이" icon={ICON} meta={section.meta} forceDegraded={!hasData}>
      <DemandBars monthly={section.monthly} unit={section.meta.unit} multiLocation={multiLocation} />
      {hasData && (
        <p style={{ fontSize: 10, color: 'var(--sub)', marginTop: 8, lineHeight: 1.5 }}>
          선택 키워드의 검색량 부분합입니다 — 전체 시장규모나 비교 가능한 성장 추이가 아닙니다.
        </p>
      )}

      {section.observedMonths.length > 0 && (
        <p style={{ fontSize: 10.5, color: 'var(--sub)', marginTop: 10 }}>
          관측 월 {section.observedMonths.length}개: {section.observedMonths.join(', ')}
        </p>
      )}
      {section.missingMonths.length > 0 && (
        <p style={{ fontSize: 10.5, color: 'var(--amber-700)', marginTop: 4 }}>
          누락 월 {section.missingMonths.length}개(0 으로 채우지 않음): {section.missingMonths.join(', ')}
        </p>
      )}

      <EvidenceDetails ids={section.meta.evidenceIds} evidenceById={evidenceById} />
    </SectionShell>
  );
}
