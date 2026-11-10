// app/(dashboard)/ads/components/AdsDashboard.tsx
// /ads 본문(Task 12): 계정 고르기 → 안전 경보·잠금 실패 배너(맨 위, 최종 판정 B1·B2) → 상태 카드(감시 스냅샷) → 7/30일 추이 → 캠페인 표.
// 데이터는 개요 API 한 번(DB만, 네이버 호출 없음). 해제 중 계정은 경고(B4).
'use client';

import Link from 'next/link';
import { errorView } from '@/lib/api/ads-format';
import { disconnectingView } from '@/lib/api/ads-safety';
import { useAdsAccounts } from '@/hooks/useAdsAccounts';
import { useAdsOverview } from '@/hooks/useAdsOverview';
import { useAdsSelectedAccount } from '@/hooks/useAdsSelectedAccount';
import { AccountPicker } from './AccountPicker';
import { CampaignTable } from './CampaignTable';
import { LockNoticeBanner, LockNoticesProvider } from './LockNotices';
import { PerformanceTrend } from './PerformanceTrend';
import { SafetyBanner } from './SafetyBanner';
import { StatusCards } from './StatusCards';
import { Card, Empty, Notice, info } from './ui';

export function AdsDashboard() {
  const accounts = useAdsAccounts();
  const { selected, select } = useAdsSelectedAccount(accounts.data);
  const overview = useAdsOverview(selected?.id ?? null);

  if (accounts.isPending) return <Empty>불러오는 중…</Empty>;
  if (accounts.error) return <Notice view={errorView(accounts.error)} />;
  if (!selected) {
    return (
      <Card title="네이버 검색광고">
        <Empty>연결된 광고 계정이 없습니다. <Link href="/ads/accounts" prefetch={false}>계정 연결</Link>에서 고객 ID와 API 키를 입력하세요.</Empty>
      </Card>
    );
  }
  const leaving = disconnectingView(selected);
  return (
    <LockNoticesProvider>
      <AccountPicker accounts={accounts.data ?? []} selected={selected} onSelect={select} />
      <LockNoticeBanner />
      {leaving && <Notice view={leaving} tone="warn" />}
      {!selected.connected && <Notice view={info('이 계정은 연결 안 됨 상태입니다. 아래는 해제 전 기록입니다. 다시 쓰려면 계정 화면에서 다시 연결하세요.')} tone="warn" />}
      {selected.status === 'invalid_key' && <Notice view={info('네이버 API 키가 더 이상 유효하지 않습니다. 감시가 이 계정을 볼 수 없습니다. 계정 화면에서 새 키로 교체하세요.')} tone="warn" />}
      {overview.isPending ? <Empty>불러오는 중…</Empty> : overview.error ? <Notice view={errorView(overview.error)} /> : overview.data && (
        <>
          <SafetyBanner alerts={overview.data.alerts} snapshot={overview.data.snapshot} />
          <StatusCards overview={overview.data} />
          <PerformanceTrend performance={overview.data.performance} />
          <CampaignTable overview={overview.data} />
        </>
      )}
    </LockNoticesProvider>
  );
}
