// app/(dashboard)/consulting/components/sections/EvidenceDetails.tsx
// 섹션 수치의 저장 근거를 hover 없이(키보드·터치 가능한 <details>) 열람하는 공통 컴포넌트.
// 서버가 검증·저장한 evidence 만 조회·표시한다 — 프론트는 값을 재계산하지 않는다(설계 §3.4).
'use client';

import type { EvidenceRef } from '../../types';
import { formatEvidenceValue, formatDate, SOURCE_LABELS } from '../../constants';

interface Props {
  /** 섹션/항목이 참조하는 evidence ID 목록 (스냅샷 evidence 에 실존) */
  ids: string[];
  evidenceById: Map<string, EvidenceRef>;
  /** 디스클로저 제목 (기본 '근거') */
  label?: string;
}

/**
 * evidence ID → 출처·라벨·관측값·단위·관측 범위를 접근 가능한 상세로 표시.
 * 해석 가능한 근거가 하나도 없으면 렌더하지 않는다(가짜 '근거 0건' 표기 방지).
 */
export function EvidenceDetails({ ids, evidenceById, label = '근거' }: Props) {
  // 중복 ID 를 제거하고 실존하는 evidence 만 해석 — 미연결 ID 로 빈 목록을 만들지 않는다.
  const seen = new Set<string>();
  const refs: EvidenceRef[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const ev = evidenceById.get(id);
    if (ev) refs.push(ev);
  }
  if (refs.length === 0) return null;

  return (
    <details style={{ marginTop: 6 }}>
      <summary style={{ fontSize: 10, color: 'var(--sub)', cursor: 'pointer', listStyle: 'revert' }}>
        {label} {refs.length}건 보기
      </summary>
      <ul style={{ margin: '4px 0 0', paddingLeft: 14, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {refs.map((ev) => {
          const hasRange = !!(ev.rangeFrom || ev.rangeTo);
          return (
            <li key={ev.id} style={{ fontSize: 10, color: 'var(--sub)', lineHeight: 1.5 }}>
              <span style={{ fontWeight: 700 }}>[{SOURCE_LABELS[ev.source] ?? ev.source}]</span> {ev.label}: {formatEvidenceValue(ev)}
              {hasRange && <span> · 범위 {formatDate(ev.rangeFrom)}~{formatDate(ev.rangeTo)}</span>}
              {ev.observedAt && <span> · 관측 {formatDate(ev.observedAt)}</span>}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
