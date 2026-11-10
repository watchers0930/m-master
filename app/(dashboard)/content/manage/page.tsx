'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ContentStatus, Channel } from '@/types/db';
import { CONTENT_PAGE_SIZE, useContentList } from '@/hooks/useContentList';
import type { ReviewListItem, ReviewStatus } from '@/types/content-review';
import { Pagination } from '@/components/Pagination';
import ContentDetailPanel from './components/ContentDetailPanel';
import ContentListFilters from './components/ContentListFilters';
import { OriginBadge, PublishStatusBadge, ReviewStatusBadge } from './components/ReviewBadge';

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
  items: ReviewListItem[];
  latestDate: string;
}

// 헤더·토픽 행·콘텐츠 행이 같은 열 너비를 쓴다. 날짜 열은 'YYYY. MM. DD.'(약 80px)가 한 줄에 들어가는 폭.
const LIST_COLUMNS = 'minmax(0, 1fr) 72px 92px';

function ContentManageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // 선택 상태의 단일 출처 = URL ?id= (변환 후 이동·딥링크·같은 페이지 쿼리 변경 모두 반영)
  const selectedId = searchParams.get('id');
  const selectContent = (id: string) => {
    const qs = new URLSearchParams(searchParams.toString());
    qs.set('id', id);
    router.replace(`${pathname}?${qs}`, { scroll: false });
  };

  const [statusFilter, setStatusFilter] = useState<ContentStatus | ''>('');
  const [reviewFilter, setReviewFilter] = useState<ReviewStatus | ''>('');
  const [page, setPage] = useState(1);
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set());

  const { data, isPending: loading, isFetching, isPlaceholderData, isError, error: listError } =
    useContentList(statusFilter, reviewFilter, page);
  const items = useMemo(() => data?.items ?? [], [data]);
  const total = data?.total ?? 0;

  // 필터 변경 → 첫 페이지부터
  const changeStatus = (v: ContentStatus | '') => { setStatusFilter(v); setPage(1); };
  const changeReview = (v: ReviewStatus | '') => { setReviewFilter(v); setPage(1); };

  // 승인·반려 등으로 건수가 줄어 현재 페이지가 비면 마지막 페이지로 당긴다
  useEffect(() => {
    if (!data || isPlaceholderData) return;
    const last = Math.max(1, Math.ceil(data.total / CONTENT_PAGE_SIZE));
    if (page > last) setPage(last);
  }, [data, isPlaceholderData, page]);

  // 딥링크로 들어온 글이 현재 목록에 있으면 해당 토픽을 펼쳐 선택 행이 보이게 한다
  useEffect(() => {
    if (!selectedId) return;
    const hit = items.find((i) => i.id === selectedId);
    if (!hit) return;
    setExpandedTopics((prev) => (prev.has(hit.topic) ? prev : new Set(prev).add(hit.topic)));
  }, [selectedId, items]);

  // 토픽 기준 그룹핑
  const groups = useMemo<TopicGroup[]>(() => {
    const map = new Map<string, ReviewListItem[]>();
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
      <ContentListFilters
        status={statusFilter}
        reviewStatus={reviewFilter}
        onStatusChange={changeStatus}
        onReviewStatusChange={changeReview}
      />

      {/* 2열 레이아웃: 좌 목록 / 우 미리보기 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.1fr)', gap: 14, flex: 1, minHeight: 0 }}>

        {/* 좌측: 목록 카드 */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
          {/* 헤더 행 */}
          <div style={{ display: 'grid', gridTemplateColumns: LIST_COLUMNS, gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'var(--n50)', flexShrink: 0 }}>
            {['토픽', '채널', '생성일'].map((h) => (
              <span key={h} style={{ fontSize: 11, fontWeight: 600, color: 'var(--sub)', whiteSpace: 'nowrap' }}>{h}</span>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--blue-400)" strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
                <path d="M21 12a9 9 0 11-6.219-8.56"/>
              </svg>
            </div>
          ) : isError ? (
            <p role="alert" style={{ textAlign: 'center', padding: '48px 0', fontSize: 12, color: '#dc2626' }}>{listError?.message || '목록을 불러오지 못했습니다'}</p>
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
                      display: 'grid', gridTemplateColumns: LIST_COLUMNS, gap: 8, alignItems: 'center',
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
                      {group.items.some((i) => i.review_status === 'pending_review') && (
                        <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 3, background: 'var(--amber-100)', color: 'var(--amber-700)', flexShrink: 0 }}>
                          검토 대기 {group.items.filter((i) => i.review_status === 'pending_review').length}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: 10.5, color: 'var(--sub)', whiteSpace: 'nowrap' }}>{group.items.length}개</span>
                    <span style={{ fontSize: 11, color: 'var(--sub)', whiteSpace: 'nowrap' }}>{new Date(group.latestDate).toLocaleDateString('ko-KR')}</span>
                  </div>

                  {/* 아코디언 바디 — 채널별 콘텐츠 */}
                  {isOpen && group.items.map((item) => {
                    const ch = CHANNEL_COLOR[item.channel] ?? CHANNEL_COLOR.blog;
                    const isSelected = selectedId === item.id;
                    return (
                      <div key={item.id}
                        style={{
                          display: 'grid', gridTemplateColumns: LIST_COLUMNS, gap: 8, alignItems: 'center',
                          padding: '8px 14px 8px 32px', borderBottom: '1px solid var(--border2)',
                          borderLeft: isSelected ? '3px solid var(--blue-400)' : '3px solid transparent',
                          background: isSelected ? 'var(--blue-50, #eff6ff)' : '',
                          transition: 'background 0.1s', cursor: 'pointer',
                        }}
                        role="button" tabIndex={0} aria-pressed={isSelected}
                        onClick={() => selectContent(item.id)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectContent(item.id); } }}
                        onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--n50)'; }}
                        onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = ''; }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <span style={{ fontSize: 10.5, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: ch.bg, color: ch.color, flexShrink: 0 }}>{CHANNEL_LABEL[item.channel] ?? item.channel}</span>
                          <PublishStatusBadge status={item.status} />
                          <ReviewStatusBadge reviewStatus={item.review_status} origin={item.origin} reviewedAt={item.reviewed_at} />
                          <OriginBadge origin={item.origin} />
                          {item.scores?.avg !== undefined && (
                            <span style={{ fontSize: 10, color: 'var(--sub)' }}>{item.scores.avg}점</span>
                          )}
                        </div>
                        <span style={{ fontSize: 10.5, color: 'var(--sub)', whiteSpace: 'nowrap' }}>{item.cost_krw.toLocaleString()}원</span>
                        <span style={{ fontSize: 10.5, color: 'var(--sub)', whiteSpace: 'nowrap' }}>{new Date(item.created_at).toLocaleDateString('ko-KR')}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
          </div>
          <Pagination page={page} perPage={CONTENT_PAGE_SIZE} total={total} onChange={setPage} busy={isFetching} />
        </div>

        {/* 우측: 미리보기 패널 */}
        <ContentDetailPanel contentId={selectedId} />
      </div>

      <p style={{ fontSize: 11, color: 'var(--sub)' }}>필터·검색·벌크액션은 Phase 2에서 확장됩니다.</p>
    </div>
  );
}

export default function ContentManagePage() {
  // useSearchParams 는 Suspense 경계가 필요하다(정적 렌더 시 CSR bailout)
  return (
    <Suspense fallback={null}>
      <ContentManageContent />
    </Suspense>
  );
}
