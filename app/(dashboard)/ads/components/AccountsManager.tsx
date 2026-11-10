// app/(dashboard)/ads/components/AccountsManager.tsx
// /ads/accounts 본문(Task 12): 연결 폼 + 계정 카드 목록(연결 안 됨 계정도 보인다 — 같은 고객 ID로 다시 연결하면 같은 기록을 이어 쓴다).
'use client';

import { errorView } from '@/lib/api/ads-format';
import { useAdsAccounts } from '@/hooks/useAdsAccounts';
import { AccountCard } from './AccountCard';
import { ConnectForm } from './ConnectForm';
import { Empty, Notice } from './ui';

export function AccountsManager() {
  const accounts = useAdsAccounts();
  return (
    <>
      <ConnectForm />
      {accounts.isPending ? <Empty>불러오는 중…</Empty> : accounts.error ? <Notice view={errorView(accounts.error)} /> :
        (accounts.data ?? []).length === 0 ? <Empty>아직 연결한 광고 계정이 없습니다.</Empty> :
          (accounts.data ?? []).map((a) => <AccountCard key={a.id} account={a} />)}
    </>
  );
}
