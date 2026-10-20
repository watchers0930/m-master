// app/(dashboard)/consulting/components/DiagnosisCard.tsx
// 진단 요약 — 강점·이슈·불확실성. 자유 서술 내 {{ev:id}} 토큰은 서버 검증 evidence 값으로 치환해 표시한다.
// (설계 §3.4·§7: 프론트는 토큰을 '조회·치환'만 하고 수치를 새로 계산하지 않는다)
'use client';

import type { Diagnosis, EvidenceRef } from '../types';
import { renderEvidenceTokens } from '../constants';
import { EvidenceChips } from './EvidenceChips';

interface Props {
  diagnosis: Diagnosis;
  evidenceById: Map<string, EvidenceRef>;
}

function PointList({
  title,
  color,
  points,
  evidenceById,
}: {
  title: string;
  color: string;
  points: { text: string; evidenceIds: string[] }[];
  evidenceById: Map<string, EvidenceRef>;
}) {
  if (!points || points.length === 0) return null;
  return (
    <div>
      <p style={{ fontSize: 11, fontWeight: 700, color, marginBottom: 6 }}>{title}</p>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {points.map((p, i) => (
          <li key={i} style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.6 }}>
            {renderEvidenceTokens(p.text, evidenceById)}
            <EvidenceChips evidenceIds={p.evidenceIds} evidenceById={evidenceById} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DiagnosisCard({ diagnosis, evidenceById }: Props) {
  return (
    <div className="card">
      <div className="card-head">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
          <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
        </svg>
        <span className="card-title">진단 요약</span>
      </div>

      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {diagnosis.summary && (
          <p style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.7 }}>
            {renderEvidenceTokens(diagnosis.summary, evidenceById)}
          </p>
        )}

        <PointList title="강점" color="var(--green-700)" points={diagnosis.strengths} evidenceById={evidenceById} />
        <PointList title="이슈" color="#dc2626" points={diagnosis.issues} evidenceById={evidenceById} />

        {diagnosis.uncertainties?.length > 0 && (
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--amber-700)', marginBottom: 6 }}>불확실성·누락</p>
            <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {diagnosis.uncertainties.map((u, i) => (
                <li key={i} style={{ fontSize: 11.5, color: 'var(--sub)', lineHeight: 1.6 }}>
                  {renderEvidenceTokens(u, evidenceById)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
