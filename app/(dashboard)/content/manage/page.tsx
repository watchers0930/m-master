'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listContents } from '@/lib/api/content';
import type { ContentStatus, Channel } from '@/types/db';
import type { ContentListItem } from '@/types/api';
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

const CHANNEL_LABEL: Record<Channel, string> = {
  blog: '블로그',
  naver_cafe: '카페',
  instagram: '인스타',
  facebook: '페이스북',
};
const CHANNEL_COLOR: Record<Channel, { bg: string; color: string }> = {
  blog:       { bg: '#e0f2fe', color: '#0369a1' },
  naver_cafe: { bg: '#dcfce7', color: '#15803d' },
  instagram:  { bg: '#fce7f3', color: '#be185d' },
  facebook:   { bg: '#dbeafe', color: '#1d4ed8' },
};

interface TopicGroup {
  topic: string;
  items: ContentListItem[];
  latestDate: string;
}

export default function ContentManagePage() {
  const [statusFilter, setStatusFilter] = useState<ContentStatus | ''>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set());

  const { data: items = [], isPending: loading } = useQuery({
    queryKey: ['contents', 'list', statusFilter || 'all'],
    queryFn: async () => {
      const res = await listContents({ status: statusFilter || undefined });
      return res.data?.items ?? [];
    },
  });

  // 토픽 기준 그룹핑
  const groups = useMemo<TopicGroup[]>(() => {
    const map = new Map<string, ContentListItem[]>();
    for (const item of items) {
      const list = map.get(item.topic) ?? [];
      list.push(item);
      map.set(item.topic, list);
    }
    return Array.from(map.entries()).map(([topic, groupItems]) => ({
      topic,
      items: groupItems,
      latestDate: groupItems.reduce((d, i) => i.created_at > d ? i.created_at : d, ''),
    })).sort((a, b) => b.latestDate.localeCompare(a.latestDate));
  }, [items]);

  function toggleTopic(topic: string) {
    setExpandedTopics((prev) => {
      const next = new Set(prev);
      if (next.has(topic)) next.delete(topic); else next.add(topic);
      return next;
    });
  }

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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 70px', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'var(--n50)', flexShrink: 0 }}>
            {['토픽', '채널', '생성일'].map((h) => (
              <span key={h} style={{ fontSize: 11, fontWeight: 600, color: 'var(--sub)' }}>{h}</span>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--blue-400)" strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
                <path d="M21 12a9 9 0 11-6.219-8.56"/>
              </svg>
            </div>
          ) : groups.length === 0 ? (
            <p style={{ textAlign: 'center', padding: '48px 0', fontSize: 12, color: 'var(--sub)' }}>콘텐츠가 없습니다</p>
          ) : (
            groups.map((group) => {
              const isOpen = expandedTopics.has(group.topic);
              return (
                <div key={group.topic}>
                  {/* 아코디언 헤더 — 토픽 제목 */}
                  <div
                    style={{
                      display: 'grid', gridTemplateColumns: '1fr 60px 70px', gap: 8, alignItems: 'center',
                      padding: '10px 14px', borderBottom: '1px solid var(--border2)',
                      cursor: 'pointer', transition: 'background 0.1s',
                      background: isOpen ? 'var(--n50)' : '',
                    }}
                    role="button" tabIndex={0}
                    onClick={() => toggleTopic(group.topic)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTopic(group.topic); } }}
                    onMouseEnter={(e) => { if (!isOpen) e.currentTarget.style.background = 'var(--n50)'; }}
                    onMouseLeave={(e) => { if (!isOpen) e.currentTarget.style.background = ''; }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, transition: 'transform 0.15s', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                        <path d="M4.5 2.5L8 6L4.5 9.5" stroke="var(--sub)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      <p style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>{group.topic}</p>
                    </div>
                    <span style={{ fontSize: 10.5, color: 'var(--sub)' }}>{group.items.length}개</span>
                    <span style={{ fontSize: 11, color: 'var(--sub)' }}>{new Date(group.latestDate).toLocaleDateString('ko-KR')}</span>
                  </div>

                  {/* 아코디언 바디 — 채널별 콘텐츠 */}
                  {isOpen && group.items.map((item) => {
                    const st = STATUS_STYLE[item.status] ?? STATUS_STYLE.draft;
                    const ch = CHANNEL_COLOR[item.channel] ?? CHANNEL_COLOR.blog;
                    const isSelected = selectedId === item.id;
                    return (
                      <div key={item.id}
                        style={{
                          display: 'grid', gridTemplateColumns: '1fr 60px 70px', gap: 8, alignItems: 'center',
                          padding: '8px 14px 8px 32px', borderBottom: '1px solid var(--border2)',
                          borderLeft: isSelected ? '3px solid var(--blue-400)' : '3px solid transparent',
                          background: isSelected ? 'var(--blue-50, #eff6ff)' : '',
                          transition: 'background 0.1s', cursor: 'pointer',
                        }}
                        role="button" tabIndex={0} aria-pressed={isSelected}
                        onClick={() => setSelectedId(item.id)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(item.id); } }}
                        onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--n50)'; }}
                        onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = ''; }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <span style={{ fontSize: 10.5, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: ch.bg, color: ch.color, flexShrink: 0 }}>{CHANNEL_LABEL[item.channel] ?? item.channel}</span>
                          <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600, background: st.bg, color: st.color, flexShrink: 0 }}>{STATUS_LABEL[item.status] ?? item.status}</span>
                          {item.scores?.avg !== undefined && (
                            <span style={{ fontSize: 10, color: 'var(--sub)' }}>{item.scores.avg}점</span>
                          )}
                        </div>
                        <span style={{ fontSize: 10.5, color: 'var(--sub)' }}>{item.cost_krw.toLocaleString()}원</span>
                        <span style={{ fontSize: 10.5, color: 'var(--sub)' }}>{new Date(item.created_at).toLocaleDateString('ko-KR')}</span>
                      </div>
                    );
                  })}
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
