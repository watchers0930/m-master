'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listContents } from '@/lib/api/content';
import type { ContentStatus } from '@/types/db';
import ContentDetailPanel from './components/ContentDetailPanel';

const STATUS_OPTIONS: { value: ContentStatus | ''; label: string }[] = [
  { value: '', label: '전체' },
  { value: 'draft', label: '초안' },
  { value: 'scheduled', label: '예약됨' },
  { value: 'published', label: '발행됨' },
  { value: 'failed', label: '실패' },
];

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  draft:     { bg: 'var(--n100)',       color: 'var(--sub)' },
  scheduled: { bg: 'var(--blue-100)',   color: 'var(--blue-600)' },
  published: { bg: 'var(--green-100)',  color: 'var(--green-700)' },
  failed:    { bg: '#fee2e2',           color: '#dc2626' },
};
const STATUS_LABEL: Record<string, string> = {
  draft: '초안', scheduled: '예약됨', published: '발행됨', failed: '실패',
};

export default function ContentManagePage() {
  const [statusFilter, setStatusFilter] = useState<ContentStatus | ''>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: items = [], isPending: loading } = useQuery({
    queryKey: ['contents', 'list', statusFilter || 'all'],
    queryFn: async () => {
      const res = await listContents({ status: statusFilter || undefined });
      return res.data?.items ?? [];
    },
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1, minHeight: 0 }}>

      <div>
        <h1 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>콘텐츠 관리</h1>
        <p style={{ fontSize: 12, color: 'var(--sub)', marginTop: 2 }}>생성된 콘텐츠를 조회·관리합니다</p>
      </div>

      {/* 필터 */}
      <div style={{ display: 'flex', gap: 6 }}>
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setStatusFilter(opt.value)}
            style={{ borderRadius: 20, padding: '4px 12px', fontSize: 11.5, fontWeight: 600, border: statusFilter === opt.value ? '1px solid var(--blue-400)' : '1px solid var(--border)', background: statusFilter === opt.value ? 'var(--blue-400)' : 'var(--surface)', color: statusFilter === opt.value ? '#fff' : 'var(--sub)', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.12s' }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* 2열 레이아웃: 좌 목록 / 우 미리보기 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.1fr)', gap: 14, flex: 1, minHeight: 0 }}>

        {/* 좌측: 목록 카드 */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
          {/* 헤더 행 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 70px', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'var(--n50)', flexShrink: 0 }}>
            {['토픽', '상태', '생성일'].map((h) => (
              <span key={h} style={{ fontSize: 11, fontWeight: 600, color: 'var(--sub)' }}>{h}</span>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--blue-400)" strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
                <path d="M21 12a9 9 0 11-6.219-8.56"/>
              </svg>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          ) : items.length === 0 ? (
            <p style={{ textAlign: 'center', padding: '48px 0', fontSize: 12, color: 'var(--sub)' }}>콘텐츠가 없습니다</p>
          ) : (
            items.map((item) => {
              const st = STATUS_STYLE[item.status] ?? STATUS_STYLE.draft;
              const avgScore = item.scores?.avg;
              const scoreColor = avgScore !== undefined ? (avgScore >= 80 ? 'var(--green-700)' : avgScore >= 60 ? 'var(--amber-700)' : '#dc2626') : undefined;
              const scoreBg = avgScore !== undefined ? (avgScore >= 80 ? 'var(--green-100)' : avgScore >= 60 ? 'var(--amber-100)' : '#fee2e2') : undefined;
              const isSelected = selectedId === item.id;
              return (
                <div key={item.id}
                  style={{
                    display: 'grid', gridTemplateColumns: '1fr 70px 70px', gap: 8, alignItems: 'center',
                    padding: '10px 14px', borderBottom: '1px solid var(--border2)',
                    borderLeft: isSelected ? '3px solid var(--blue-400)' : '3px solid transparent',
                    background: isSelected ? 'var(--blue-50, #eff6ff)' : '',
                    transition: 'background 0.1s', cursor: 'pointer',
                  }}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  onClick={() => setSelectedId(item.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(item.id); } }}
                  onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--n50)'; }}
                  onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = ''; }}
                >
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>{item.topic}</p>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
                      <span style={{ fontSize: 10.5, color: 'var(--sub)' }}>블로그</span>
                      {avgScore !== undefined && (
                        <>
                          <span style={{ color: 'var(--border)', fontSize: 10 }}>·</span>
                          <span style={{ fontSize: 10.5, padding: '1px 6px', borderRadius: 3, fontWeight: 600, background: scoreBg, color: scoreColor }}>{avgScore}점</span>
                        </>
                      )}
                      <span style={{ color: 'var(--border)', fontSize: 10 }}>·</span>
                      <span style={{ fontSize: 10.5, color: 'var(--sub)' }}>{item.cost_krw.toLocaleString()}원</span>
                    </div>
                  </div>
                  <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10.5, fontWeight: 600, background: st.bg, color: st.color, justifySelf: 'start' }}>{STATUS_LABEL[item.status] ?? item.status}</span>
                  <span style={{ fontSize: 11, color: 'var(--sub)' }}>{new Date(item.created_at).toLocaleDateString('ko-KR')}</span>
                </div>
              );
            })
          )}
          </div>
        </div>

        {/* 우측: 미리보기 패널 */}
        <ContentDetailPanel contentId={selectedId} />
      </div>

      <p style={{ fontSize: 11, color: 'var(--sub)' }}>필터·검색·벌크액션은 Phase 2에서 확장됩니다.</p>
    </div>
  );
}
