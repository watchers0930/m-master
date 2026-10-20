// app/(dashboard)/consulting/components/PriorityActionsCard.tsx
// 우선순위 액션 — P0/P1/P2. destination enum 은 서버 allowlist 값이며, 프론트는 고정 경로로만 매핑한다.
// (설계 §7: /content/create 는 검증된 title 만 topic 쿼리로, SEO/GEO 는 domainId 쿼리로 딥링크)
// 설명 내 {{ev:id}} 토큰은 서버 검증 evidence 값으로 치환해 표시한다(재계산 없음).
'use client';

import Link from 'next/link';
import type { PriorityAction, EvidenceRef } from '../types';
import {
  CHANNEL_LABELS,
  PRIORITY_META,
  DESTINATION_CTA,
  destinationHref,
  renderEvidenceTokens,
} from '../constants';
import { EvidenceChips } from './EvidenceChips';

interface Props {
  actions: PriorityAction[];
  evidenceById: Map<string, EvidenceRef>;
  domainId: string;
}

export function PriorityActionsCard({ actions, evidenceById, domainId }: Props) {
  // P0 → P1 → P2 순으로 정렬해 표시(서버 우선순위 보존, 표시 순서만 정규화)
  const order = { P0: 0, P1: 1, P2: 2 } as const;
  const sorted = [...actions].sort((a, b) => order[a.priority] - order[b.priority]);

  return (
    <div className="card">
      <div className="card-head">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
          <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
        </svg>
        <span className="card-title">우선순위 액션</span>
      </div>

      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {sorted.map((a) => {
          const pm = PRIORITY_META[a.priority];
          // 서버가 허용한 {{ev:id}} 토큰을 검증 evidence 값으로 치환(§3.4·지적 3). 치환된 title 을 콘텐츠 topic 딥링크에도 사용해 내부 표기가 새지 않게 한다.
          const titleDisplay = renderEvidenceTokens(a.title, evidenceById);
          const metricDisplay = renderEvidenceTokens(a.metric, evidenceById);
          const href = destinationHref(a.destination, { domainId, title: titleDisplay });
          return (
            <div key={a.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: pm.color, background: pm.bg, borderRadius: 5, padding: '2px 8px' }}>{pm.label}</span>
                <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--sub)', background: 'var(--n100)', borderRadius: 5, padding: '2px 8px' }}>{CHANNEL_LABELS[a.channel]}</span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>{titleDisplay}</span>
              </div>

              <p style={{ fontSize: 11.5, color: 'var(--text)', lineHeight: 1.6 }}>
                {renderEvidenceTokens(a.description, evidenceById)}
              </p>

              {a.metric && (
                <p style={{ fontSize: 10.5, color: 'var(--sub)' }}>관측 지표: {metricDisplay}</p>
              )}

              <EvidenceChips evidenceIds={a.evidenceIds} evidenceById={evidenceById} />

              <div style={{ marginTop: 2 }}>
                <Link href={href} className="btn btn-ghost" style={{ padding: '5px 12px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {DESTINATION_CTA[a.destination]}
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
