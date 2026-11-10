// app/(dashboard)/ads/components/ProposalList.tsx
// 광고 제안 목록(Task 12): 상태 필터 + 최신순 키셋 페이지(더 보기). 위반 남은 제안은 표시한다(승인 불가).
'use client';

import Link from 'next/link';
import { useState } from 'react';
import { errorView, formatKrw, proposalStatusLabel } from '@/lib/api/ads-format';
import { useAdsProposals } from '@/hooks/useAdsProposals';
import type { AdProposalStatus } from '@/types/ads';
import { Card, Empty, Notice, inputStyle, numStyle, subText, tableStyle, tdStyle, thStyle } from './ui';

const FILTERS: (AdProposalStatus | '')[] = ['', 'pending_review', 'approved', 'apply_failed', 'applied', 'rejected'];

export function ProposalList({ accountId }: { accountId: string }) {
  const [status, setStatus] = useState<AdProposalStatus | ''>('');
  const list = useAdsProposals({ take: 20, accountId, ...(status ? { status } : {}) });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const filter = (
    <select value={status} onChange={(e) => setStatus(e.target.value as AdProposalStatus | '')} style={{ ...inputStyle, width: 'auto' }}>
      {FILTERS.map((s) => <option key={s} value={s}>{s ? proposalStatusLabel(s) : '전체'}</option>)}
    </select>
  );
  return (
    <Card title="제안 목록" right={filter} bodyStyle={{ padding: 0, gap: 0 }}>
      {list.isPending ? <Empty>불러오는 중…</Empty> : list.error ? <div style={{ padding: 16 }}><Notice view={errorView(list.error)} /></div> : items.length === 0 ? (
        <Empty>제안이 없습니다. 위에서 AI 제안을 만들어 보세요.</Empty>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={{ ...thStyle, paddingLeft: 16 }}>만든 시각</th><th style={thStyle}>종류</th><th style={thStyle}>상태</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>그룹·키워드</th><th style={{ ...thStyle, textAlign: 'right' }}>남은 위반</th>
                <th style={{ ...thStyle, textAlign: 'right', paddingRight: 16 }}>AI 비용</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td style={{ ...tdStyle, paddingLeft: 16 }}><Link href={`/ads/proposals/${p.id}`} prefetch={false}>{new Date(p.createdAt).toLocaleString('ko-KR')}</Link></td>
                  <td style={tdStyle}>{p.kind === 'extend_group' ? '광고그룹 확장' : '새 캠페인'}</td>
                  <td style={tdStyle}>{proposalStatusLabel(p.status)}</td>
                  <td style={numStyle}>{p.groupCount} · {p.keywordCount}</td>
                  <td style={{ ...numStyle, color: p.lintIssueCount > 0 ? '#b91c1c' : 'var(--text)' }}>{p.lintIssueCount}건</td>
                  <td style={{ ...numStyle, paddingRight: 16 }}>{formatKrw(Math.round(p.costKrw))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.hasNextPage && (
            <div style={{ padding: '10px 16px', display: 'flex', justifyContent: 'center', borderTop: '1px solid var(--border2)' }}>
              <button type="button" className="btn btn-ghost" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                {list.isFetchingNextPage ? '불러오는 중…' : '더 보기'}
              </button>
            </div>
          )}
        </div>
      )}
      <div style={{ ...subText, padding: '10px 16px', borderTop: '1px solid var(--border2)' }}>AI 비용은 제안을 만드는 데 쓴 AI 호출 비용입니다(광고비 아님).</div>
    </Card>
  );
}
