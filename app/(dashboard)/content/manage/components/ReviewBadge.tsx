// 콘텐츠 상태 배지 — 자동 생성(origin)·검토 상태·발행 상태를 서로 다른 배지로 (설계 §6).
// 발행 상태(status)와 검토 상태(review_status)는 독립이다(부록 A).
import type { ContentStatus } from '@/types/db';
import type { ContentOrigin, ReviewStatus } from '../types';

type Tone = { bg: string; color: string };

const badge = (t: Tone, size: 'sm' | 'md'): React.CSSProperties => ({
  display: 'inline-block', flexShrink: 0, borderRadius: size === 'sm' ? 3 : 4,
  padding: size === 'sm' ? '1px 6px' : '2px 8px', fontSize: size === 'sm' ? 10 : 10.5,
  fontWeight: 600, background: t.bg, color: t.color,
});

export const STATUS_LABEL: Record<ContentStatus, string> = {
  draft: '초안', scheduled: '예약됨', published: '발행됨', failed: '실패',
};
const STATUS_TONE: Record<ContentStatus, Tone> = {
  draft:     { bg: 'var(--n100)',      color: 'var(--sub)' },
  scheduled: { bg: 'var(--blue-100)',  color: 'var(--blue-600)' },
  published: { bg: 'var(--green-100)', color: 'var(--green-700)' },
  failed:    { bg: '#fee2e2',          color: '#dc2626' },
};

export const REVIEW_LABEL: Record<ReviewStatus, string> = {
  pending_review: '검토 대기', approved: '승인', rejected: '반려',
};
const REVIEW_TONE: Record<ReviewStatus, Tone> = {
  pending_review: { bg: 'var(--amber-100)', color: 'var(--amber-700)' },
  approved:       { bg: '#e0e7ff',          color: '#4338ca' },
  rejected:       { bg: '#fee2e2',          color: '#b91c1c' },
};

export function PublishStatusBadge({ status, size = 'sm' }: { status: ContentStatus; size?: 'sm' | 'md' }) {
  return <span style={badge(STATUS_TONE[status] ?? STATUS_TONE.draft, size)}>{STATUS_LABEL[status] ?? status}</span>;
}

/**
 * 검토 배지. 수동 생성·기존 행의 기본 승인(reviewed_at 없음)은 검토 대상이 아니므로 배지를 생략한다 —
 * 모든 기존 글에 '승인'이 붙어 실제 검토가 필요한 글이 묻히는 것을 막는다.
 */
export function ReviewStatusBadge({
  reviewStatus, origin, reviewedAt, size = 'sm',
}: { reviewStatus: ReviewStatus; origin: ContentOrigin; reviewedAt: string | null; size?: 'sm' | 'md' }) {
  if (reviewStatus === 'approved' && origin === 'manual' && !reviewedAt) return null;
  const tone = REVIEW_TONE[reviewStatus];
  if (!tone) return null;
  return <span style={badge(tone, size)}>{REVIEW_LABEL[reviewStatus]}</span>;
}

export function OriginBadge({ origin, size = 'sm' }: { origin: ContentOrigin; size?: 'sm' | 'md' }) {
  if (origin !== 'auto') return null;
  return (
    <span style={{ ...badge({ bg: '#f3e8ff', color: '#7e22ce' }, size), border: '1px solid #e9d5ff' }} title="자동 파이프라인이 생성한 콘텐츠">
      자동 생성
    </span>
  );
}
