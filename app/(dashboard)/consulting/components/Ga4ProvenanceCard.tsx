// app/(dashboard)/consulting/components/Ga4ProvenanceCard.tsx
// GA4 수집 출처 카드 — 속성·host·수집시각·기간·완전성·실패 보고서 (GA4 설계 §4.8·§6).
// 표시 전용. 값은 서버 동결 스냅샷 그대로이며 리포트 조회 시 재수집하지 않는다(GET 무수집).
import type { Ga4ProvenanceDTO } from '../types';
import { formatDateTime } from '../constants';

const REPORT_LABELS: Record<string, string> = {
  channels: '채널',
  sourceMedium: '소스/매체',
  landing: '랜딩 페이지',
  pages: '페이지',
  events: '이벤트',
};

const ERROR_LABELS: Record<string, string> = {
  invalid_credentials: '인증 오류',
  credential_storage_error: '관리자 설정 오류(자격증명 키) — 운영자 확인 필요',
  permission_denied: '권한 없음',
  quota_exceeded: '할당량 초과',
  timeout: '시간 초과',
  upstream_error: 'GA4 응답 오류',
  invalid_query: '조회 조건 오류',
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 11 }}>
      <span style={{ color: 'var(--sub)', width: 64, flexShrink: 0 }}>{label}</span>
      <span style={{ color: 'var(--text)', minWidth: 0, overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  );
}

export function Ga4ProvenanceCard({ p }: { p: Ga4ProvenanceDTO }) {
  const partial = p.completeness === 'partial';
  return (
    <section className="card" aria-label="GA4 데이터 출처" style={{ padding: '12px 16px', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>GA4 데이터 출처</span>
        <span
          style={{
            fontSize: 12, fontWeight: 600, borderRadius: 5, padding: '2px 7px', background: 'var(--n100)',
            color: partial ? 'var(--amber-700)' : 'var(--green-700)',
          }}
        >
          {partial ? '부분 수집' : '전체 수집'}
        </span>
      </div>
      <Row label="속성" value={p.property_id} />
      <Row label="호스트" value={p.host} />
      <Row label="기간" value={`${p.range.startDate} ~ ${p.range.endDate}${p.time_zone ? ` (${p.time_zone} 기준)` : ''}`} />
      <Row label="수집 시각" value={formatDateTime(p.collected_at)} />
      {p.failed_reports.length > 0 && (
        <Row
          label="누락 보고서"
          value={p.failed_reports.map((f) => `${REPORT_LABELS[f.report] ?? f.report}(${ERROR_LABELS[f.code] ?? f.code})`).join(', ')}
        />
      )}
    </section>
  );
}
