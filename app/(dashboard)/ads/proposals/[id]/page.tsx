// app/(dashboard)/ads/proposals/[id]/page.tsx — AI 광고 제안 검토·편집·승인/반려·적용·켜기/끄기(Task 12). 조립만 한다.
// 허용목록(ADS_OWNER_IDS) 밖이면 존재를 숨긴다(404). 남의 제안 id는 API가 404(IDOR).
export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { isAdsOwner } from '@/lib/ads/access';
import { ProposalDetail } from '../../components/ProposalDetail';

export default async function AdsProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!isAdsOwner(session?.user?.id)) notFound();
  const { id } = await params;
  return <ProposalDetail id={id} />;
}
