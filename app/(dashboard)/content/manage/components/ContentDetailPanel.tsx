'use client';

// 콘텐츠 상세 패널 — 레이아웃만 담당 (설계 §6 분리).
// 조회=useContentDetail · 검토=ContentReviewBar · 수정=ContentEditForm · 근거=StrategyEvidenceCard ·
// 본문=ContentBodyPreview · 발행·변환·A/B=ContentPublishActions.

import { useState } from 'react';
import { useContentDetail } from '@/hooks/useContentDetail';
import type { ReviewNotice } from '@/hooks/useContentReview';
import ContentReviewBar, { NoticeLine } from './ContentReviewBar';
import ContentEditForm from './ContentEditForm';
import StrategyEvidenceCard from './StrategyEvidenceCard';
import ContentBodyPreview from './ContentBodyPreview';
import ContentPublishActions from './ContentPublishActions';
import { OriginBadge, PublishStatusBadge, ReviewStatusBadge } from './ReviewBadge';

const CHANNEL_LABEL: Record<string, string> = {
  blog: '블로그', naver_cafe: '네이버 카페', instagram: '인스타그램', facebook: '페이스북',
};

interface Props {
  contentId: string | null;
}

export default function ContentDetailPanel({ contentId }: Props) {
  // 선택이 바뀌면 편집 상태·안내를 버린다 (렌더 중 이전 선택과 비교 — effect 없이 동기 리셋)
  const [editing, setEditing] = useState(false);
  const [editNotice, setEditNotice] = useState<ReviewNotice | null>(null);
  const [formRev, setFormRev] = useState(0); // 409 충돌 시에만 증가 → 최신본으로 폼 재시작
  const [shownId, setShownId] = useState(contentId);
  if (shownId !== contentId) {
    setShownId(contentId);
    setEditing(false);
    setEditNotice(null);
  }

  const { data: content, isFetching, error: queryError } = useContentDetail(contentId);
  const data = contentId ? content ?? null : null;
  const loading = !!contentId && isFetching && !data;
  // 백그라운드 재조회 실패는 기존 본문을 지우지 않는다 — 데이터가 없을 때만 오류 화면
  const errorMsg = contentId && queryError && !data ? queryError.message || '콘텐츠를 불러오지 못했습니다' : null;

  // 발행됨·발행 진행 중이면 수정 불가 (서버도 409 already_published / publish_in_progress 로 차단)
  const editBlocked = data ? data.status === 'published' || data.publish?.active_claim === true : true;

  const avg = data?.scores?.avg;
  const scoreColor = avg !== undefined ? (avg >= 80 ? 'var(--green-700)' : avg >= 60 ? 'var(--amber-700)' : '#dc2626') : undefined;
  const scoreBg    = avg !== undefined ? (avg >= 80 ? 'var(--green-100)' : avg >= 60 ? 'var(--amber-100)' : '#fee2e2') : undefined;

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: 0 }}>{editing ? '수정' : '미리보기'}</h2>
        {data && !editing && (
          <button
            type="button" className="btn btn-ghost" style={{ fontSize: 11.5, padding: '4px 10px' }}
            disabled={editBlocked}
            title={editBlocked ? '발행됐거나 발행 중인 콘텐츠는 수정할 수 없습니다' : undefined}
            onClick={() => { setEditNotice(null); setEditing(true); }}
          >
            수정
          </button>
        )}
      </div>

      {/* 본문 영역 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
        {!contentId ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--sub)', gap: 8 }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="14 2 14 8 20 8"/>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            </svg>
            <p style={{ fontSize: 12, margin: 0 }}>왼쪽 목록에서 콘텐츠를 선택하세요</p>
          </div>
        ) : loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--blue-400)" strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
              <path d="M21 12a9 9 0 11-6.219-8.56"/>
            </svg>
          </div>
        ) : errorMsg ? (
          <p style={{ color: '#dc2626', fontSize: 12.5, padding: '24px 0', textAlign: 'center' }}>{errorMsg}</p>
        ) : data ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* 토픽 + 메타 */}
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', margin: 0, lineHeight: 1.4 }}>{data.topic}</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--sub)' }}>{CHANNEL_LABEL[data.channel] ?? data.channel}</span>
                <span style={{ color: 'var(--border)' }}>·</span>
                <span style={{ fontSize: 11, color: 'var(--sub)' }}>톤: {data.tone ?? '—'}</span>
                <span style={{ color: 'var(--border)' }}>·</span>
                <span style={{ fontSize: 11, color: 'var(--sub)' }}>{new Date(data.created_at).toLocaleString('ko-KR')}</span>
                {data.parent_content_id && (
                  <>
                    <span style={{ color: 'var(--border)' }}>·</span>
                    <span style={{ fontSize: 11, color: 'var(--sub)' }} title={`원본 ${data.parent_content_id}`}>파생 콘텐츠</span>
                  </>
                )}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                <OriginBadge origin={data.origin} size="md" />
                <ReviewStatusBadge reviewStatus={data.review_status} origin={data.origin} reviewedAt={data.reviewed_at} size="md" />
                <PublishStatusBadge status={data.status} size="md" />
                {avg !== undefined && (
                  <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600, background: scoreBg, color: scoreColor }}>
                    AI {avg}점
                  </span>
                )}
                <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600, background: 'var(--n100)', color: 'var(--sub)' }}>
                  비용 {data.cost_krw.toLocaleString()}원
                </span>
              </div>
            </div>

            {/* 편집 중에는 검토 상태를 바꾸지 않는다(초안 기준 버전이 어긋남) */}
            {!editing && <ContentReviewBar key={data.id} content={data} />}
            <NoticeLine notice={editNotice} />
            {data.strategy_context && <StrategyEvidenceCard ctx={data.strategy_context} />}

            {editing ? (
              // 백그라운드 재조회로는 폼을 리셋하지 않는다(초안 보존). 409 충돌 때만 formRev 로 최신본 재시작
              <ContentEditForm
                key={`${data.id}:${formRev}`}
                content={data}
                onClose={() => setEditing(false)}
                onResult={(n, kind) => {
                  setEditNotice(n);
                  if (kind === 'saved') setEditing(false);
                  else setFormRev((r) => r + 1);
                }}
              />
            ) : (
              <ContentBodyPreview data={data} />
            )}
          </div>
        ) : null}
      </div>

      {/* 푸터 */}
      {data && !editing && <ContentPublishActions key={data.id} content={data} />}
    </div>
  );
}
