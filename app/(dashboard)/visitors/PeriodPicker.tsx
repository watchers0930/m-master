'use client';

const OPTIONS = [
  { value: 'today', label: '오늘' },
  { value: 'this_week', label: '이번 주' },
  { value: 'this_month', label: '이번 달' },
  { value: '7d', label: '최근 7일' },
  { value: '30d', label: '최근 30일' },
  { value: '90d', label: '최근 90일' },
  { value: '365d', label: '최근 1년' },
];

export function PeriodPicker({ value, onChange }: { value: string; onChange?: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {OPTIONS.map(opt => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange?.(opt.value)}
            style={{
              padding: '5px 10px',
              fontSize: 11,
              borderRadius: 6,
              border: `1px solid ${active ? 'var(--blue-400)' : 'var(--border)'}`,
              background: active ? 'var(--blue-400)' : 'var(--surface)',
              color: active ? '#fff' : 'var(--text)',
              fontWeight: active ? 600 : 500,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'all 0.15s',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
