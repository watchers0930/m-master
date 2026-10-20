// app/(dashboard)/consulting/components/EvidenceChips.tsx
// 근거(evidence) 칩 표시 — 서버가 전달한 검증된 관측값만 보여준다(설계 §3.4).
// 프론트는 값을 계산하지 않고 evidenceById 에서 조회해 라벨·값·출처만 표시한다.
'use client';

import type { EvidenceRef, EvidenceSource } from '../types';
import { SOURCE_LABELS, formatEvidenceValue, formatDate } from '../constants';

const SOURCE_COLOR: Record<EvidenceSource, string> = {
  seo: '#1b356f',
  geo: '#2a7d5f',
  ga4: '#7c3aed',
  status: 'var(--sub)',
};

interface Props {
  evidenceIds: string[];
  evidenceById: Map<string, EvidenceRef>;
}

export function EvidenceChips({ evidenceIds, evidenceById }: Props) {
  if (!evidenceIds || evidenceIds.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
      {evidenceIds.map((id) => {
        const ev = evidenceById.get(id);
        const color = ev ? SOURCE_COLOR[ev.source] : 'var(--sub)';
        const when = ev?.observedAt ? ` · ${formatDate(ev.observedAt)}` : '';
        return (
          <span
            key={id}
            title={ev ? `${SOURCE_LABELS[ev.source]} · ${ev.label}${when}` : '근거를 찾을 수 없음'}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, color, background: 'var(--n100)', borderRadius: 5, padding: '2px 7px', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {ev ? `${ev.label}: ${formatEvidenceValue(ev)}` : '근거 없음'}
          </span>
        );
      })}
    </div>
  );
}
