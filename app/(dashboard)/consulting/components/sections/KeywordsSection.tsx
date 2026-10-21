// app/(dashboard)/consulting/components/sections/KeywordsSection.tsx
// 05 전체 키워드 — 키워드별 관측 지표·직접 순위·출처·기간·상태 테이블.
// 광고 경쟁도(adCompetition)와 자연검색 난이도(difficulty)를 구분 표기한다(설계 §3.3-05).
// 프론트는 정렬·필터만 하고 수치를 재계산하지 않는다(여기선 서버 순서 보존).
'use client';

import type { CSSProperties } from 'react';
import type { KeywordsSection as KeywordsSectionDTO, Currency } from '../../types';
import { formatMetric, formatAdCompetition, formatCurrencyMetric, formatDate } from '../../constants';
import { SectionShell } from './SectionShell';

const ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
    <path d="M3 6h18M3 12h18M3 18h18" />
  </svg>
);

const TH: CSSProperties = { fontSize: 10, fontWeight: 700, color: 'var(--sub)', textAlign: 'left', padding: '6px 8px', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' };
const TD: CSSProperties = { fontSize: 11.5, color: 'var(--text)', padding: '6px 8px', whiteSpace: 'nowrap', borderBottom: '1px solid var(--n100)' };

export function KeywordsSection({ section }: { section: KeywordsSectionDTO }) {
  const currency: Currency | null = section.meta.currency;
  const hasRows = section.rows.length > 0;
  return (
    <SectionShell title="전체 키워드" icon={ICON} meta={section.meta} forceDegraded={!hasRows}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead>
            <tr>
              <th style={TH}>키워드</th>
              <th style={{ ...TH, textAlign: 'right' }}>검색량</th>
              <th style={{ ...TH, textAlign: 'right' }}>난이도</th>
              <th style={{ ...TH, textAlign: 'right' }}>CPC</th>
              <th style={TH}>광고 경쟁도</th>
              <th style={{ ...TH, textAlign: 'right' }}>참고 가치</th>
              <th style={{ ...TH, textAlign: 'right' }}>순위</th>
              <th style={TH}>기간</th>
              <th style={TH}>상태</th>
            </tr>
          </thead>
          <tbody>
            {section.rows.map((r) => (
              <tr key={r.keywordId}>
                <td style={{ ...TD, fontWeight: 600, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.keyword}</td>
                <td style={{ ...TD, textAlign: 'right' }}>{formatMetric(r.volume)}</td>
                <td style={{ ...TD, textAlign: 'right' }}>{formatMetric(r.difficulty)}</td>
                <td style={{ ...TD, textAlign: 'right' }}>{formatCurrencyMetric(r.cpc, currency)}</td>
                <td style={TD}>{formatAdCompetition(r.adCompetition)}</td>
                <td style={{ ...TD, textAlign: 'right' }}>{formatCurrencyMetric(r.adValue, currency)}</td>
                {/* 순위 출처를 title(hover)에만 두지 않고 가시 텍스트로 노출 — 키보드·터치로 확인 가능(지적 4) */}
                <td style={{ ...TD, textAlign: 'right' }}>
                  {formatMetric(r.rank)}
                  {r.rank !== null && r.rankSource && (
                    <span style={{ display: 'block', fontSize: 9, fontWeight: 400, color: 'var(--sub)', whiteSpace: 'normal', lineHeight: 1.4 }}>{r.rankSource}</span>
                  )}
                </td>
                <td style={TD}>{r.period ? `${formatDate(r.period.from)}~${formatDate(r.period.to)}` : '—'}</td>
                <td style={TD}>{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionShell>
  );
}
