// app/(dashboard)/ads/page.tsx — 네이버 검색광고 대시보드(Task 12). 조립만 한다(섹션은 components/, 데이터는 hooks/useAds*).
// 허용목록(ADS_OWNER_IDS) 밖이면 존재를 숨긴다(404) — API도 같은 규칙.
export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { isAdsOwner } from '@/lib/ads/access';
import { AdsDashboard } from './components/AdsDashboard';

export default async function AdsPage() {
  const session = await auth();
  if (!isAdsOwner(session?.user?.id)) notFound();
  return <AdsDashboard />;
}
