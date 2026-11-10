// app/(dashboard)/ads/components/ProposalsManager.tsx
// /ads/proposals 본문(Task 12): 계정 고르기 → 제안 만들기 → 제안 목록.
'use client';

import Link from 'next/link';
import { errorView } from '@/lib/api/ads-format';
import { useAdsAccounts } from '@/hooks/useAdsAccounts';
import { useAdsSelectedAccount } from '@/hooks/useAdsSelectedAccount';
import { AccountPicker } from './AccountPicker';
import { ProposalCreateForm } from './ProposalCreateForm';
import { ProposalList } from './ProposalList';
import { Card, Empty, Notice } from './ui';

export function ProposalsManager() {
  const accounts = useAdsAccounts();
  const { selected, select } = useAdsSelectedAccount(accounts.data);
  if (accounts.isPending) return <Empty>불러오는 중…</Empty>;
  if (accounts.error) return <Notice view={errorView(accounts.error)} />;
  if (!selected) {
    return <Card title="AI 광고 제안"><Empty>먼저 <Link href="/ads/accounts" prefetch={false}>광고 계정을 연결</Link>하세요.</Empty></Card>;
  }
  return (
    <>
      <AccountPicker accounts={accounts.data ?? []} selected={selected} onSelect={select} />
      <ProposalCreateForm key={selected.id} account={selected} />
      <ProposalList accountId={selected.id} />
    </>
  );
}
