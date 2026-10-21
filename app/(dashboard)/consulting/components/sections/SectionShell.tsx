// app/(dashboard)/consulting/components/sections/SectionShell.tsx
// 구조화 리포트 6섹션 공통 카드 — 제목·상태 배지·근거 메타(기간·선택표본·커버리지)를 표시한다.
// degrade(missing|unmapped|error) 시 children 대신 "준비 필요" 플레이스홀더를 렌더한다.
// (설계 §3.3: 빈 0배열로 가짜 차트를 만들지 않는다 — 근거 없으면 사유를 명시한다)
'use client';

import type { ReactNode } from 'react';
import type { SectionMeta } from '../../types';
import { SOURCE_STATUS_META, formatDate, formatCoverage } from '../../constants';

interface Props {
  title: string;
  icon: ReactNode;
  meta: SectionMeta;
  /** children 이 자체 빈 상태를 갖는 경우(예: items=null) 강제 degrade 표기 */
  forceDegraded?: boolean;
  children: ReactNode;
}

/** 섹션 근거 메타 한 줄 — 기간·단위·지역·선택 표본·커버리지·관측시각. 값이 없으면 생략 */
function MetaLine({ meta }: { meta: SectionMeta }) {
  const parts: string[] = [];
  if (meta.period) parts.push(`기간 ${formatDate(meta.period.from)} ~ ${formatDate(meta.period.to)}`);
  if (meta.unit) parts.push(`단위 ${meta.unit}`);
  if (meta.location != null) parts.push(`지역 ${meta.location}`);
  if (meta.selection) parts.push(`표본 ${meta.selection.selected}/${meta.selection.total} (상한 ${meta.selection.limit})`);
  const cov = formatCoverage(meta.coverage);
  if (cov) parts.push(`커버리지 ${cov}`);
  if (meta.observedAt) parts.push(`관측 ${formatDate(meta.observedAt)}`);
  if (parts.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 10.5, color: 'var(--sub)', marginBottom: 10 }}>
      {parts.map((p, i) => (
        <span key={i}>{i > 0 ? `· ${p}` : p}</span>
      ))}
    </div>
  );
}

export function SectionShell({ title, icon, meta, forceDegraded, children }: Props) {
  const sm = SOURCE_STATUS_META[meta.sourceStatus] ?? { label: meta.sourceStatus, color: 'var(--sub)' };
  // degrade = 근거 자체가 없음. partial/stale 은 부분 자료라도 표시한다.
  const degraded = forceDegraded || meta.sourceStatus === 'missing' || meta.sourceStatus === 'unmapped' || meta.sourceStatus === 'error';

  return (
    <div className="card">
      <div className="card-head">
        {icon}
        <span className="card-title">{title}</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, color: sm.color, background: 'var(--n100)', borderRadius: 5, padding: '2px 8px' }}>
          {degraded ? '준비 필요' : sm.label}
        </span>
      </div>

      <div style={{ padding: '14px 16px' }}>
        {degraded ? (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', borderRadius: 7, background: 'var(--n100)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--sub)" strokeWidth="1.8" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}>
              <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
            </svg>
            <p style={{ fontSize: 11.5, color: 'var(--sub)', lineHeight: 1.6, margin: 0 }}>
              {meta.reason ?? '아직 수집된 근거가 없어 이 섹션은 준비 중입니다. 관련 진단을 수집하면 자동으로 채워집니다.'}
            </p>
          </div>
        ) : (
          <>
            <MetaLine meta={meta} />
            {/* partial/stale 등 '표시 가능하나 제한된' 자료의 서버 사유를 버리지 않는다(설계 §3.3).
                배지만으로는 무엇이 빠졌고 무엇을 해석하면 안 되는지 알 수 없다(예: GEO 근거만·SERP 지도 부재). */}
            {meta.reason && (
              <div
                role="note"
                style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '8px 10px', marginBottom: 10, borderRadius: 7, background: 'var(--amber-100)' }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--amber-700)" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}>
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><path d="M12 9v4M12 17h.01" />
                </svg>
                <p style={{ fontSize: 11, color: 'var(--amber-700)', lineHeight: 1.6, margin: 0 }}>{meta.reason}</p>
              </div>
            )}
            {children}
          </>
        )}
      </div>
    </div>
  );
}
