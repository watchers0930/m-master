// app/(dashboard)/ads/proposals/page.tsx — AI 광고 제안 만들기·목록(Task 12). 조립만 한다.
// 허용목록(ADS_OWNER_IDS) 밖이면 존재를 숨긴다(404) — API도 같은 규칙.
export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { isAdsOwner } from '@/lib/ads/access';
import { ProposalsManager } from '../components/ProposalsManager';

export default async function AdsProposalsPage() {
  const session = await auth();
  if (!isAdsOwner(session?.user?.id)) notFound();
  return <ProposalsManager />;
}
