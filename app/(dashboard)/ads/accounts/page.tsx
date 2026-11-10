// app/(dashboard)/ads/accounts/page.tsx — 네이버 검색광고 계정 연결·비즈채널·키 교체·해제(Task 12). 조립만 한다.
// 허용목록(ADS_OWNER_IDS) 밖이면 존재를 숨긴다(404) — API도 같은 규칙.
export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { isAdsOwner } from '@/lib/ads/access';
import { AccountsManager } from '../components/AccountsManager';

export default async function AdsAccountsPage() {
  const session = await auth();
  if (!isAdsOwner(session?.user?.id)) notFound();
  return <AccountsManager />;
}
