import type { ReactNode } from 'react';
import './dashboard.css';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar />
      <div className="main">
        <Topbar />
        <div className="content">
          {children}
        </div>
      </div>
    </div>
  );
}
