'use client';

import { useRouter } from 'next/navigation';
import type { AbTestListRow } from '@/types/api';
import AbTestStatusBadge from './AbTestStatusBadge';

interface Props {
  test: AbTestListRow;
}

// design.md §3.1 변형 A/B 원형 배지
function VariantBadge({ label, variant }: { label: string; variant: 'a' | 'b' }) {
  const isA = variant === 'a';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 20,
        height: 20,
        borderRadius: '50%',
        background: isA ? 'var(--blue-600)' : 'var(--amber-500)',
        color: '#fff',
        fontSize: 10,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {label}
    </span>
  );
}

export default function AbTestCard({ test }: Props) {
  const router = useRouter();

  const handleClick = () => router.push(`/ab-test/${test.id}`);
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  const winnerLabel =
    test.winner === 'a'   ? '승자: 변형 A' :
    test.winner === 'b'   ? '승자: 변형 B' :
    test.winner === 'tie' ? '동률' : null;

  const winnerStyle =
    test.winner === 'a'   ? { bg: 'var(--blue-100)',  color: 'var(--blue-600)' } :
    test.winner === 'b'   ? { bg: 'var(--amber-100)', color: 'var(--amber-700)' } :
    test.winner === 'tie' ? { bg: 'var(--n100)',      color: 'var(--sub)' } : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--blue-50)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--surface)')}
      style={{
        background: 'var(--surface)',
        borderRadius: 10,
        border: '1px solid var(--border)',
        padding: '14px 16px',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        transition: 'background 0.12s',
        outline: 'none',
      }}
    >
      {/* 변형 토픽 미니뷰 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <VariantBadge label="A" variant="a" />
          <p
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: 'var(--text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              lineHeight: 1.4,
            }}
          >
            {test.variant_a_topic}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <VariantBadge label="B" variant="b" />
          <p
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: 'var(--text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              lineHeight: 1.4,
            }}
          >
            {test.variant_b_topic}
          </p>
        </div>
      </div>

      {/* 구분선 */}
      <div style={{ height: 1, background: 'var(--border2)' }} />

      {/* 메타 정보 */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <AbTestStatusBadge status={test.status} />
        <span style={{ fontSize: 11, color: 'var(--sub)' }}>
          측정 {test.measure_days}일
        </span>
        {winnerLabel && winnerStyle && (
          <span
            style={{
              display: 'inline-block',
              padding: '2px 8px',
              borderRadius: 4,
              fontSize: 10.5,
              fontWeight: 600,
              background: winnerStyle.bg,
              color: winnerStyle.color,
            }}
          >
            {winnerLabel}
          </span>
        )}
        <span style={{ fontSize: 11, color: 'var(--sub)', marginLeft: 'auto' }}>
          {new Date(test.created_at).toLocaleDateString('ko-KR')}
        </span>
      </div>
    </div>
  );
}
