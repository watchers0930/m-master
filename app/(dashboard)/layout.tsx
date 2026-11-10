import type { ReactNode } from 'react';
import { auth } from '@/lib/auth';
import { isAdsOwner } from '@/lib/ads/access';
import './dashboard.css';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  // '광고' 메뉴는 허용목록(ADS_OWNER_IDS) 사용자에게만 — 서버에서 판정해 내려 준다(목록 밖은 메뉴 자체가 없다)
  const session = await auth();
  const adsEnabled = isAdsOwner(session?.user?.id);
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar adsEnabled={adsEnabled} />
      <div className="main">
        <Topbar />
        <div className="content">
          {children}
        </div>
      </div>
    </div>
  );
}
