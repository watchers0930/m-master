// components/Pagination.tsx
// 공용 페이지 이동 바 — 이전/다음 + 현재 위치 표시. 표시·입력만 담당(데이터 패칭은 부모 훅).
'use client';

interface Props {
  page: number;
  perPage: number;
  total: number;
  onChange: (page: number) => void;
  /** 다음 페이지를 불러오는 중이면 버튼 비활성 */
  busy?: boolean;
}

export function Pagination({ page, perPage, total, onChange, busy }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  if (total <= perPage && page <= 1) return null;
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(total, page * perPage);

  return (
    <nav
      aria-label="페이지 이동"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 14px', borderTop: '1px solid var(--border)', flexShrink: 0 }}
    >
      <span style={{ fontSize: 11, color: 'var(--sub)' }}>
        전체 {total.toLocaleString()}건 중 {from.toLocaleString()}–{to.toLocaleString()}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button" className="btn btn-ghost" style={{ fontSize: 11.5, padding: '4px 10px' }}
          disabled={busy || page <= 1} onClick={() => onChange(page - 1)}
        >
          이전
        </button>
        <span style={{ fontSize: 11.5, color: 'var(--text)', fontWeight: 600 }} aria-current="page">{page} / {totalPages}</span>
        <button
          type="button" className="btn btn-ghost" style={{ fontSize: 11.5, padding: '4px 10px' }}
          disabled={busy || page >= totalPages} onClick={() => onChange(page + 1)}
        >
          다음
        </button>
      </div>
    </nav>
  );
}
