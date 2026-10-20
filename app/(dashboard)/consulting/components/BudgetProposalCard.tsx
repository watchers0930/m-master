// app/(dashboard)/consulting/components/BudgetProposalCard.tsx
// 예산 제안 — 채널별 배분 금액·비율. 금액은 서버가 계산(round·largest-remainder 보정)한 값을 표시만 한다(설계 §4.2).
// totalAmount 미입력이면 amount=null → '비율만 제안'. 프론트는 금액을 재계산·환산하지 않는다.
// 전제(assumptions) 서술은 서버가 허용한 {{ev:id}} 토큰을 검증 evidence 값으로 치환해 표시한다(§3.4·지적 3).
'use client';

import type { BudgetProposal, EvidenceRef } from '../types';
import { CHANNEL_LABELS, CHANNEL_COLORS, formatAmount, formatRatio, renderEvidenceTokens } from '../constants';

interface Props {
  budget: BudgetProposal;
  evidenceById: Map<string, EvidenceRef>;
}

export function BudgetProposalCard({ budget, evidenceById }: Props) {
  const hasAmounts = budget.totalAmount !== null && budget.totalAmount !== undefined;

  return (
    <div className="card">
      <div className="card-head">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
          <rect x="1" y="4" width="22" height="16" rx="2" ry="2" /><line x1="1" y1="10" x2="23" y2="10" />
        </svg>
        <span className="card-title">예산 제안</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>
          {hasAmounts ? `총 ${formatAmount(budget.totalAmount, budget.currency)}` : '비율만 제안'}
        </span>
      </div>

      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!hasAmounts && (
          <p style={{ fontSize: 11, color: 'var(--sub)' }}>
            월 예산을 입력하지 않아 금액 대신 배분 비율만 제안합니다. 생성 패널에서 예산을 입력하면 채널별 금액을 계산합니다.
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {budget.allocations.map((a) => (
            <div key={a.channel} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: CHANNEL_COLORS[a.channel], flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: 'var(--text)', flex: 1 }}>{CHANNEL_LABELS[a.channel]}</span>
              <span style={{ fontSize: 11.5, color: 'var(--sub)', width: 48, textAlign: 'right' }}>{formatRatio(a.ratio)}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', width: 120, textAlign: 'right' }}>
                {hasAmounts ? formatAmount(a.amount, budget.currency) : '—'}
              </span>
            </div>
          ))}
        </div>

        {budget.assumptions?.length > 0 && (
          <div style={{ marginTop: 4 }}>
            <p style={{ fontSize: 10.5, color: 'var(--sub)', fontWeight: 600, marginBottom: 4 }}>전제</p>
            <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {budget.assumptions.map((s, i) => (
                <li key={i} style={{ fontSize: 10.5, color: 'var(--sub)', lineHeight: 1.6 }}>{renderEvidenceTokens(s, evidenceById)}</li>
              ))}
            </ul>
          </div>
        )}

        <p style={{ fontSize: 10, color: 'var(--sub)', marginTop: 2 }}>
          네이버 광고 배분은 집행 전 참고 제안이며, 예상 CPC·ROAS·매출은 표시하지 않습니다(실집행은 후속 단계).
        </p>
      </div>
    </div>
  );
}
