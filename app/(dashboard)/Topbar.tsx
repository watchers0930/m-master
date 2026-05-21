'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const PAGE_TITLES: Record<string, string> = {
  '/': '대시보드',
  '/content/create': '콘텐츠 생성',
  '/content/manage': '콘텐츠 관리',
  '/scheduler': '스케줄러',
  '/channels': '채널 연동',
  '/analytics': '성과 분석',
  '/visitors': '방문자 분석',
  '/ab-test': 'A/B 테스트',
  '/rag': 'RAG 지식베이스',
  '/settings': '설정',
};

function getNow() {
  const d = new Date();
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
}

export function Topbar() {
  const pathname = usePathname();
  const title = Object.entries(PAGE_TITLES).find(([k]) => k === '/' ? pathname === '/' : pathname.startsWith(k))?.[1] ?? '대시보드';

  return (
    <div className="topbar">
      <div className="topbar-title">{title}</div>
      <div className="topbar-date">{getNow()}</div>
      <div className="topbar-right">
        <button className="btn btn-ghost notif-wrap" style={{ padding: '7px 9px' }}>
          <svg className="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 01-3.46 0"/>
          </svg>
          <span className="notif-dot"></span>
        </button>
        <Link href="/content/create" className="btn btn-primary">
          <svg className="icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          새 콘텐츠 생성
        </Link>
      </div>
    </div>
  );
}
