// app/(dashboard)/ads/components/ProposalEntities.tsx
// 적용으로 만든 네이버 항목(Task 12): 캠페인·광고그룹·키워드·소재별 검수 상태 · 켜짐 상태(lockedBy) · 켜기·끄기.
// 데이터는 계정 개요(DB 미러)에서 이 제안의 것만 고른다 — 네이버를 부르지 않는다. 검수는 30분마다 동기화된다.
// 켜기 전제(서버가 강제): 비상 정지 해제 · 오늘 비용 < 상한 · 검수 승인(키워드·소재) · 네이버 설정 대조. 감시가 오늘 끈 항목은 내일 0시에 자동 재개.
'use client';

import { errorView, inspectLabel, isInspectPassed } from '@/lib/api/ads-format';
import { useAdsOverview } from '@/hooks/useAdsOverview';
import type { AdLockEntityType, AdMirrorBaseDTO } from '@/types/ads';
import { LockButton } from './LockButton';
import { Card, Empty, LockBadge, Notice, subText, tableStyle, tdStyle, thStyle } from './ui';

type Row = { type: AdLockEntityType; kind: string; label: string; row: AdMirrorBaseDTO; needsInspect: boolean };

export function ProposalEntities({ proposalId, accountId }: { proposalId: string; accountId: string }) {
  const overview = useAdsOverview(accountId);
  if (overview.isPending) return <Empty>불러오는 중…</Empty>;
  if (overview.error) return <Notice view={errorView(overview.error)} />;
  const o = overview.data;
  const mine = <T extends AdMirrorBaseDTO>(list: T[]) => list.filter((x) => x.proposalId === proposalId);
  const rows: Row[] = [
    ...mine(o.campaigns).map((r) => ({ type: 'campaign' as const, kind: '캠페인', label: r.name, row: r, needsInspect: false })),
    ...mine(o.groups).map((r) => ({ type: 'adgroup' as const, kind: '광고그룹', label: `${r.name} · 입찰 ${r.bidAmt ?? '—'}원`, row: r, needsInspect: false })),
    ...mine(o.keywords).map((r) => ({ type: 'keyword' as const, kind: '키워드', label: `${r.keyword} · 입찰 ${r.bidAmt ?? '—'}원`, row: r, needsInspect: true })),
    ...mine(o.ads).map((r) => ({ type: 'ad' as const, kind: '소재', label: `${r.headline} / ${r.description}`, row: r, needsInspect: true })),
  ];
  return (
    <Card title="네이버에 만든 항목" right={<span style={subText}>{rows.length}개 · 검수는 30분마다 동기화</span>} bodyStyle={{ padding: 0, gap: 0 }}>
      {rows.length === 0 ? <Empty>아직 만든 항목이 없습니다.</Empty> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr><th style={{ ...thStyle, paddingLeft: 16 }}>종류</th><th style={thStyle}>내용</th><th style={thStyle}>검수</th><th style={thStyle}>상태</th><th style={{ ...thStyle, paddingRight: 16 }}>켜기·끄기</th></tr>
            </thead>
            <tbody>
              {rows.map(({ type, kind, label, row, needsInspect }) => (
                <tr key={`${type}-${row.id}`}>
                  <td style={{ ...tdStyle, paddingLeft: 16, whiteSpace: 'nowrap' }}>{kind}</td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span>{label}</span>
                      <span style={subText}>{row.naverId}</span>
                    </div>
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: needsInspect && !isInspectPassed(row.inspectStatus) ? 'var(--amber-700)' : 'var(--text)' }}>
                    {needsInspect ? inspectLabel(row.inspectStatus) : '—'}
                  </td>
                  <td style={tdStyle}><LockBadge userLock={row.userLock} lockedBy={row.lockedBy} /></td>
                  <td style={{ ...tdStyle, paddingRight: 16 }}><LockButton accountId={accountId} type={type} row={row} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
