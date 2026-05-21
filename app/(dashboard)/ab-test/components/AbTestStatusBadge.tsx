'use client';

import type { AbTestStatus } from '@/types/db';

// design.md §3.2 상태 배지 색상 매핑
const STATUS_STYLE: Record<AbTestStatus, { bg: string; color: string }> = {
  draft:     { bg: 'var(--n100)',       color: 'var(--sub)' },
  running:   { bg: 'var(--blue-100)',   color: 'var(--blue-600)' },
  completed: { bg: 'var(--green-100)',  color: 'var(--green-700)' },
  cancelled: { bg: 'var(--n100)',       color: 'var(--n400)' },
};

const STATUS_LABEL: Record<AbTestStatus, string> = {
  draft:     '초안',
  running:   '측정중',
  completed: '완료',
  cancelled: '취소됨',
};

interface Props {
  status: AbTestStatus;
}

export default function AbTestStatusBadge({ status }: Props) {
  const st = STATUS_STYLE[status] ?? STATUS_STYLE.draft;
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 10.5,
        fontWeight: 600,
        background: st.bg,
        color: st.color,
      }}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
