// app/(dashboard)/ads/components/CampaignTable.tsx
// 캠페인 표(Task 12): 미러 캠페인 + 7/30일 성과(캠페인별) + 켜짐 상태(lockedBy) + 켜기·끄기. 제안에서 만든 캠페인은 제안 상세로 이어진다.
'use client';

import Link from 'next/link';
import type { AdOverviewDTO } from '@/types/ads';
import { costPerSignup, ctr, formatCount, formatKrw, inspectLabel } from '@/lib/api/ads-format';
import { LockButton } from './LockButton';
import { Card, Empty, LockBadge, numStyle, subText, tableStyle, tdStyle, thStyle } from './ui';

export function CampaignTable({ overview }: { overview: AdOverviewDTO }) {
  const perf = new Map(overview.performance.campaigns.map((p) => [p.naverId, p]));
  const groupCount = new Map<string, number>();
  for (const g of overview.groups) if (g.parentNaverId) groupCount.set(g.parentNaverId, (groupCount.get(g.parentNaverId) ?? 0) + 1);
  const rows = overview.campaigns;
  return (
    <Card title="캠페인" right={<span style={subText}>{rows.length}개{overview.truncated.campaigns ? ' (일부만 표시)' : ''}</span>} bodyStyle={{ padding: 0, gap: 0 }}>
      {rows.length === 0 ? (
        <Empty>아직 MINTEQ로 만든 캠페인이 없습니다. <Link href="/ads/proposals" prefetch={false}>AI 제안</Link>을 승인·적용하면 여기에 나타납니다.</Empty>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={{ ...thStyle, paddingLeft: 16 }}>캠페인</th>
                <th style={thStyle}>상태</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>7일 비용</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>30일 비용</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>30일 클릭(클릭률)</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>30일 전환 · 가입당 비용</th>
                <th style={{ ...thStyle, paddingRight: 16 }}>켜기·끄기</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const p = perf.get(c.naverId);
                const d7 = p?.days7, d30 = p?.days30;
                return (
                  <tr key={c.id}>
                    <td style={{ ...tdStyle, paddingLeft: 16 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ fontWeight: 700 }}>{c.proposalId ? <Link href={`/ads/proposals/${c.proposalId}`} prefetch={false}>{c.name}</Link> : c.name}</span>
                        <span style={subText}>{c.naverId} · 광고그룹 {groupCount.get(c.naverId) ?? 0}개{c.inspectStatus ? ` · 검수 ${inspectLabel(c.inspectStatus)}` : ''}</span>
                      </div>
                    </td>
                    <td style={tdStyle}><LockBadge userLock={c.userLock} lockedBy={c.lockedBy} /></td>
                    <td style={numStyle}>{formatKrw(d7?.costKrw ?? 0)}</td>
                    <td style={numStyle}>{formatKrw(d30?.costKrw ?? 0)}</td>
                    <td style={numStyle}>{formatCount(d30?.clkCnt ?? 0)} ({ctr(d30?.clkCnt ?? 0, d30?.impCnt ?? 0)})</td>
                    <td style={numStyle}>{formatCount(d30?.ccnt ?? 0)} · {costPerSignup(d30?.costKrw ?? 0, d30?.ccnt ?? 0)}</td>
                    <td style={{ ...tdStyle, paddingRight: 16 }}><LockButton accountId={overview.account.id} type="campaign" row={c} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
