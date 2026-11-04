// 콘텐츠 목록 필터 — 발행 상태 + 검토 상태 (설계 §6). 표시·입력만 담당.
import type { ContentStatus } from '@/types/db';
import type { ReviewStatus } from '@/types/content-review';

const STATUS_OPTIONS: { value: ContentStatus | ''; label: string }[] = [
  { value: '', label: '전체' },
  { value: 'draft', label: '초안' },
  { value: 'scheduled', label: '예약됨' },
  { value: 'published', label: '발행됨' },
  { value: 'failed', label: '실패' },
];

const REVIEW_OPTIONS: { value: ReviewStatus | ''; label: string }[] = [
  { value: '', label: '전체' },
  { value: 'pending_review', label: '검토 대기' },
  { value: 'approved', label: '승인' },
  { value: 'rejected', label: '반려' },
];

function Chip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        borderRadius: 20, padding: '4px 12px', fontSize: 11.5, fontWeight: 600,
        border: active ? '1px solid var(--blue-400)' : '1px solid var(--border)',
        background: active ? 'var(--blue-400)' : 'var(--surface)',
        color: active ? '#fff' : 'var(--sub)', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.12s',
      }}
    >
      {label}
    </button>
  );
}

interface Props {
  status: ContentStatus | '';
  reviewStatus: ReviewStatus | '';
  onStatusChange: (v: ContentStatus | '') => void;
  onReviewStatusChange: (v: ReviewStatus | '') => void;
}

export default function ContentListFilters({ status, reviewStatus, onStatusChange, onReviewStatusChange }: Props) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 11, color: 'var(--sub)', fontWeight: 600, marginRight: 2 }}>발행</span>
      {STATUS_OPTIONS.map((o) => (
        <Chip key={`s-${o.value}`} active={status === o.value} label={o.label} onClick={() => onStatusChange(o.value)} />
      ))}
      <span style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 6px' }} />
      <span style={{ fontSize: 11, color: 'var(--sub)', fontWeight: 600, marginRight: 2 }}>검토</span>
      {REVIEW_OPTIONS.map((o) => (
        <Chip key={`r-${o.value}`} active={reviewStatus === o.value} label={o.label} onClick={() => onReviewStatusChange(o.value)} />
      ))}
    </div>
  );
}
