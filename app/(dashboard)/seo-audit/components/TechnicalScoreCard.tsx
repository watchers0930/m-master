// app/(dashboard)/seo-audit/components/TechnicalScoreCard.tsx
// 기술 점수·커버리지·수집 표본 요약. 설계 §4.3: technicalScore null=비포함/판정부족,
// coverage<0.7 → '참고 점수' 배지. 홈 1페이지 진단을 '전체 도메인 완료'로 표현하지 않는다.
'use client';

import type { SeoAuditDTO } from '@/types/seo';
import { COVERAGE_WARN, MODE_LABELS, formatPercent } from '../constants';

function scoreColor(score: number): string {
  if (score >= 80) return 'var(--green-700)';
  if (score >= 50) return 'var(--amber-700)';
  return '#dc2626';
}

export function TechnicalScoreCard({ audit }: { audit: SeoAuditDTO }) {
  const score = audit.technicalScore;
  const coverage = audit.coverage;
  const lowCoverage = coverage !== null && coverage < COVERAGE_WARN;

  return (
    <div className="card">
      <div className="card-head">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><path d="M22 4L12 14.01l-3-3" />
        </svg>
        <span className="card-title">기술 점수</span>
        {audit.scoreVersion && (
          <span style={{ marginLeft: 'auto', fontSize: 9.5, color: 'var(--sub)' }}>기준 {audit.scoreVersion}</span>
        )}
      </div>

      <div style={{ padding: '16px', display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ textAlign: 'center', minWidth: 96 }}>
          {score === null ? (
            <>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--sub)' }}>—</div>
              <div style={{ fontSize: 10.5, color: 'var(--sub)', marginTop: 2 }}>판정 부족</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 40, fontWeight: 800, lineHeight: 1, color: scoreColor(score), fontFamily: "'SCoreDream', 'Paperlogy', sans-serif" }}>
                {score}
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--sub)', marginTop: 4 }}>/ 100점</div>
            </>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 180, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5 }}>
            <span style={{ color: 'var(--sub)' }}>평가 커버리지</span>
            <span style={{ color: 'var(--text)', fontWeight: 700 }}>{formatPercent(coverage)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5 }}>
            <span style={{ color: 'var(--sub)' }}>수집 페이지</span>
            <span style={{ color: 'var(--text)', fontWeight: 700 }}>
              {audit.crawledPages ?? '—'}
              {audit.requestedPages ? ` / 요청 ${audit.requestedPages}` : ''}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5 }}>
            <span style={{ color: 'var(--sub)' }}>수집 모드</span>
            <span style={{ color: 'var(--text)', fontWeight: 700 }}>{audit.mode ? MODE_LABELS[audit.mode] : '—'}</span>
          </div>

          {lowCoverage && (
            <div style={{ marginTop: 2, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'var(--amber-700)', background: 'var(--amber-100)', borderRadius: 5, padding: '4px 8px', alignSelf: 'flex-start' }}>
              참고 점수 · 판정 근거가 부족합니다(커버리지 {formatPercent(coverage)})
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
