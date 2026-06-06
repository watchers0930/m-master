'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { signOut, useSession } from 'next-auth/react';
import { listContents } from '@/lib/api/content';
import { listSlots } from '@/lib/api/schedule';

function Badge({ count }: { count: number }) {
  if (count === 0) return null;
  return <span className="sb-badge">{count > 99 ? '99+' : count}</span>;
}

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const active = (href: string) => href === '/' ? pathname === '/' : pathname.startsWith(href);

  const [draftCount, setDraftCount] = useState(0);
  const [todayCount, setTodayCount] = useState(0);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);

    listContents({ status: 'draft' }).then(res => {
      setDraftCount(res.data?.items.length ?? 0);
    });

    const now = new Date();
    listSlots({ year: now.getFullYear(), month: now.getMonth() + 1 }).then(res => {
      const todayScheduled = (res.data ?? []).filter(
        s => s.status === 'scheduled' && s.scheduled_at.startsWith(today)
      ).length;
      setTodayCount(todayScheduled);
    });
  }, []);

  return (
    <aside className="sidebar">
      <div className="sb-logo">
        <div className="sb-logo-mark">
          <div className="sb-logo-box">
            <svg width="18" height="18" viewBox="0 0 90 90" fill="none">
              <path d="M16 66L32 22L45 46L58 22L74 66" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="sb-brand">MINTEQ</span>
        </div>
        <div className="sb-url">minteq.vercel.app</div>
      </div>

      <div className="sb-section">
        <div className="sb-label">메인</div>
        <Link href="/" prefetch={false} className={`sb-item${active('/') ? ' active' : ''}`}>
          <svg className="icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
            <rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>
          </svg>
          대시보드
          <Badge count={todayCount} />
        </Link>
        <Link href="/content/create" prefetch={false} className={`sb-item${active('/content/create') ? ' active' : ''}`}>
          <svg className="icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          콘텐츠 생성
        </Link>
        <Link href="/content/manage" prefetch={false} className={`sb-item${active('/content/manage') ? ' active' : ''}`}>
          <svg className="icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
          </svg>
          콘텐츠 관리
          <Badge count={draftCount} />
        </Link>
      </div>

      <div className="sb-section">
        <div className="sb-label">분석</div>
        <Link href="/ab-test" prefetch={false} className={`sb-item${active('/ab-test') ? ' active' : ''}`}>
          <svg className="icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M9 3h6M9 3v8L5 21h14L15 11V3"/>
          </svg>
          A/B 테스트
        </Link>
        <Link href="/analytics" prefetch={false} className={`sb-item${active('/analytics') ? ' active' : ''}`}>
          <svg className="icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M18 20V10M12 20V4M6 20v-6"/>
          </svg>
          성과 분석
        </Link>
        <Link href="/visitors" prefetch={false} className={`sb-item${active('/visitors') ? ' active' : ''}`}>
          <svg className="icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
          </svg>
          방문자 분석
        </Link>
      </div>

      {/* 운영 섹션: 스케줄러는 자동 크론으로 운영 — 메뉴 숨김 */}

      <div className="sb-section">
        <div className="sb-label">설정</div>
        <Link href="/rag" prefetch={false} className={`sb-item${active('/rag') ? ' active' : ''}`}>
          <svg className="icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <ellipse cx="12" cy="5" rx="9" ry="3"/>
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
          </svg>
          RAG 문서 DB
        </Link>
        <Link href="/channels" prefetch={false} className={`sb-item${active('/channels') ? ' active' : ''}`}>
          <svg className="icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
          </svg>
          채널 연동
        </Link>
        <Link href="/settings" prefetch={false} className={`sb-item${active('/settings') ? ' active' : ''}`}>
          <svg className="icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
          </svg>
          설정
        </Link>
        <Link href="/billing" prefetch={false} className={`sb-item${active('/billing') ? ' active' : ''}`}>
          <svg className="icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
            <line x1="1" y1="10" x2="23" y2="10"/>
          </svg>
          과금/플랜
        </Link>
      </div>

      <div className="sb-bottom">
        <div className="sb-avatar">{session?.user?.name?.[0] ?? 'M'}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="sb-uname">{session?.user?.name ?? 'MINTEQ'}</div>
          <div className="sb-uemail">{session?.user?.email ?? ''}</div>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          title="로그아웃"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#94a3b8', flexShrink: 0 }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
        </button>
      </div>
    </aside>
  );
}
