// app/(dashboard)/ads/components/ProposalActions.tsx
// 제안 결정·적용 버튼(Task 12). 모든 결정은 expected_updated_at(CAS)을 보낸다 — 409 version_conflict면 최신을 다시 읽고 알린다.
// - 검토 대기: 저장(바뀐 것이 있을 때) · 승인(위반 0건이고 저장된 상태일 때만 — 서버도 강제) · 반려(사유 선택).
// - 승인됨·적용 실패: 네이버에 적용(모든 항목은 꺼진 상태로 만든다). 결과 failCode는 한국어로, 네이버 화면 조치가 필요한 것은 크게.
'use client';

import { useState } from 'react';
import { errorView, failCodeMessage, isUrgentFailCode, type ErrorView } from '@/lib/api/ads-format';
import { useAdsProposalActions } from '@/hooks/useAdsProposal';
import type { AdProposalDTO, ProposalPayload } from '@/types/ads';
import { Notice, info, inputStyle } from './ui';

type Props = { proposal: AdProposalDTO; draft: ProposalPayload; dirty: boolean; issueCount: number };

export function ProposalActions({ proposal, draft, dirty, issueCount }: Props) {
  const { edit, review, apply } = useAdsProposalActions(proposal.id, proposal.accountId);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<{ view: ErrorView; ok: boolean } | null>(null);
  const busy = edit.isPending || review.isPending || apply.isPending;
  const fail = (err: unknown) => setNotice({ view: errorView(err), ok: false });
  const ok = (message: string) => setNotice({ view: info(message), ok: true });

  const save = () => {
    setNotice(null);
    edit.mutate({ expectedUpdatedAt: proposal.updatedAt, payload: draft }, {
      onSuccess: (p) => ok(p.lintIssueCount > 0 ? `저장했습니다. 남은 위반 ${p.lintIssueCount}건을 고쳐야 승인할 수 있습니다.` : '저장했습니다. 위반이 없어 승인할 수 있습니다.'),
      onError: fail,
    });
  };
  const decide = (decision: 'approve' | 'reject') => {
    if (decision === 'reject' && !confirm('이 제안을 반려합니다. 반려한 제안은 다시 편집할 수 없습니다. 계속할까요?')) return;
    setNotice(null);
    review.mutate({ decision, expectedUpdatedAt: proposal.updatedAt, ...(decision === 'reject' ? { reason } : {}) }, {
      onSuccess: () => ok(decision === 'approve' ? '승인했습니다. 이제 네이버에 적용할 수 있습니다.' : '반려했습니다.'),
      onError: fail,
    });
  };
  const runApply = () => {
    if (!confirm('네이버에 캠페인·광고그룹·키워드·소재를 만듭니다. 모든 항목은 꺼진 상태로 만들어지고, 켜기는 따로 해야 합니다. 계속할까요?')) return;
    setNotice(null);
    apply.mutate(undefined, {
      onSuccess: (r) => {
        if (r.status === 'applied') ok('적용했습니다. 모든 항목이 꺼진 상태입니다. 검수가 끝나면 아래에서 켜세요.');
        else setNotice({ view: { message: failCodeMessage(r.failCode ?? null) ?? '적용하지 못했습니다.', urgent: isUrgentFailCode(r.failCode), reload: true }, ok: false });
      },
      onError: fail,
    });
  };

  const s = proposal.status;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {s === 'pending_review' && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="btn btn-teal" disabled={!dirty || busy} onClick={save}>{edit.isPending ? '저장·검사 중…' : '저장'}</button>
          <button type="button" className="btn btn-primary" disabled={dirty || issueCount > 0 || busy} onClick={() => decide('approve')}
            title={dirty ? '먼저 저장하세요' : issueCount > 0 ? '위반을 모두 고쳐야 승인할 수 있습니다' : undefined}>
            {review.isPending && review.variables?.decision === 'approve' ? '승인 중…' : '승인'}
          </button>
          <input placeholder="반려 사유(선택)" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} style={{ ...inputStyle, width: 220 }} />
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => decide('reject')}>반려</button>
          {(dirty || issueCount > 0) && <span style={{ fontSize: 12, color: 'var(--sub)' }}>{dirty ? '바뀐 내용을 저장하면 다시 검사합니다.' : `위반 ${issueCount}건이 남아 승인할 수 없습니다.`}</span>}
        </div>
      )}
      {(s === 'approved' || s === 'apply_failed') && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={runApply}>
            {apply.isPending ? '네이버에 적용 중(최대 5분)…' : s === 'apply_failed' ? '이어서 적용' : '네이버에 적용'}
          </button>
          <span style={{ fontSize: 12, color: 'var(--sub)' }}>이미 만든 항목은 다시 만들지 않고 이어서 진행합니다.</span>
        </div>
      )}
      {s === 'applying' && <Notice view={info('적용이 진행 중입니다. 잠시 후 새로고침하세요(10분 넘게 멈추면 다시 적용할 수 있습니다).')} tone="info" />}
      {notice && <Notice view={notice.view} tone={notice.ok ? 'ok' : 'error'} />}
    </div>
  );
}
