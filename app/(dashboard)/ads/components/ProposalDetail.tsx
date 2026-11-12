// app/(dashboard)/ads/components/ProposalDetail.tsx
// /ads/proposals/[id] 본문(Task 12): 제안 상태 · 남은 위반 안내 · 광고그룹 편집(검토 대기일 때만) · 결정·적용 · 만든 항목(검수·켜기/끄기).
// 편집본(draft)은 서버 버전(updatedAt)이 바뀌면 새로 받는다(저장·충돌 재조회 후). 바꾼 뒤에는 위반 위치가 달라질 수 있어 저장 전엔 위반을 숨긴다.
'use client';

import Link from 'next/link';
import { useState } from 'react';
import { errorView, failCodeMessage, isUrgentFailCode, proposalStatusLabel } from '@/lib/api/ads-format';
import { useAdsProposal } from '@/hooks/useAdsProposal';
import type { AdProposalDTO, ProposalGroup } from '@/types/ads';
import { LockNoticeBanner, LockNoticesProvider } from './LockNotices';
import { ProposalActions } from './ProposalActions';
import { ProposalEntities } from './ProposalEntities';
import { ProposalGroupEditor } from './ProposalGroupEditor';
import { Card, Empty, Notice, info, subText } from './ui';

function Body({ proposal }: { proposal: AdProposalDTO }) {
  const [draft, setDraft] = useState(proposal.payload);
  const [version, setVersion] = useState(proposal.updatedAt);
  if (version !== proposal.updatedAt) { // 서버 버전이 바뀌었다(저장·충돌 재조회) → 편집본을 최신으로
    setVersion(proposal.updatedAt);
    setDraft(proposal.payload);
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify(proposal.payload);
  const editable = proposal.status === 'pending_review';
  const issues = proposal.lintResult?.issues ?? [];
  const setGroup = (i: number, g: ProposalGroup) => setDraft({ groups: draft.groups.map((x, n) => (n === i ? g : x)) });
  const failMessage = failCodeMessage(proposal.failCode);
  const applied = proposal.status === 'applied' || proposal.status === 'apply_failed' || proposal.status === 'applying';

  return (
    <LockNoticesProvider>
      <LockNoticeBanner />
      <Card title={`AI 광고 제안 · ${proposal.kind === 'extend_group' ? '광고그룹 확장' : '새 캠페인'}`} right={<Link href="/ads/proposals" prefetch={false} className="btn btn-ghost">목록</Link>}>
        <div style={subText}>
          상태 <b style={{ color: 'var(--text)' }}>{proposalStatusLabel(proposal.status)}</b> · 그룹 {proposal.groupCount}개 · 키워드 {proposal.keywordCount}개 ·
          만든 시각 {new Date(proposal.createdAt).toLocaleString('ko-KR')}{proposal.reviewedAt ? ` · 결정 ${new Date(proposal.reviewedAt).toLocaleString('ko-KR')}` : ''}
          {proposal.targetAdgroupId ? ` · 대상 광고그룹 ${proposal.targetAdgroupId}` : ''}
        </div>
        {failMessage && <Notice view={{ message: `마지막 적용 실패: ${failMessage}`, urgent: isUrgentFailCode(proposal.failCode), reload: false }} />}
        {editable && issues.length > 0 && (
          <Notice view={info(`AI가 1회 교정한 뒤에도 남은 등록 기준 위반 ${issues.length}건이 있습니다. 표시된 칸을 고쳐 저장하면 다시 검사합니다. 위반이 0건이어야 승인할 수 있습니다.`)} tone="warn" />
        )}
        {dirty && <Notice view={info('바뀐 내용이 있습니다. 저장하면 등록 기준과 입찰 상한을 다시 검사합니다(그 전에는 위반 표시를 숨깁니다).')} tone="info" />}
        <ProposalActions proposal={proposal} draft={draft} dirty={dirty} issueCount={issues.length} />
      </Card>
      {draft.groups.map((g, i) => (
        <ProposalGroupEditor key={i} index={i} group={g} issues={dirty ? [] : issues} editable={editable} bidRange={proposal.bidRange} onChange={(next) => setGroup(i, next)} />
      ))}
      {applied && <ProposalEntities proposalId={proposal.id} accountId={proposal.accountId} />}
    </LockNoticesProvider>
  );
}

export function ProposalDetail({ id }: { id: string }) {
  const proposal = useAdsProposal(id);
  if (proposal.isPending) return <Empty>불러오는 중…</Empty>;
  if (proposal.error) return <Notice view={errorView(proposal.error)} />;
  return <Body proposal={proposal.data} />;
}
