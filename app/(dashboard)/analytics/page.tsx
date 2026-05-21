'use client';

// 성과 분석 페이지
// A — 콘텐츠별 성과 테이블 (GA4 page_path × 발행 콘텐츠)
// B — 채널×요일 히트맵 (기존 /api/analytics/ga4-pattern 재사용)
// C — 네이버 검색 성과 (TODO: 별도 단계에서 추가)

import { useState } from 'react';
import { ContentPerformanceTable } from './components/ContentPerformanceTable';
import { DowHeatmap } from './components/DowHeatmap';

const PERIOD_OPTIONS = [
  { value: 7,  label: '최근 7일' },
  { value: 30, label: '최근 30일' },
  { value: 90, label: '최근 90일' },
];

export default function AnalyticsPage() {
  const [days, setDays] = useState<number>(30);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 1100 }}>

      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>성과 분석</h1>
          <p style={{ fontSize: 12, color: 'var(--sub)', marginTop: 2 }}>
            발행한 콘텐츠의 GA4 성과 + 채널별 요일 패턴 통합 뷰
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--sub)' }}>기간</span>
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setDays(opt.value)}
              style={{
                padding: '5px 10px',
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 4,
                border: `1px solid ${days === opt.value ? 'var(--blue-600)' : 'var(--n200)'}`,
                background: days === opt.value ? 'var(--blue-600)' : '#fff',
                color: days === opt.value ? '#fff' : 'var(--text)',
                cursor: 'pointer',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* A. 콘텐츠별 성과 */}
      <ContentPerformanceTable days={days} />

      {/* B. 채널×요일 히트맵 */}
      <DowHeatmap />

      {/* C. 네이버 검색 성과 — 다음 단계에서 추가 */}
    </div>
  );
}
