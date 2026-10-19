// app/(dashboard)/visibility/components/VisibilityFilters.tsx
// 집계 필터 UI (시장·기간·질문·엔진). 상태는 page 가 소유하고 onChange 로 전달받음.
'use client';

import { MARKETS, type EngineId, type Market } from '@/types/visibility';
import type { VisibilityQueryDTO } from '@/types/visibility';
import { ALL_ENGINES, ENGINE_LABELS, MARKET_LABELS } from '../constants';

export interface FiltersState {
  market: Market;
  from: string;
  to: string;
  queryId: string | null;
  engine: EngineId | null;
}

interface Props {
  value: FiltersState;
  queries: VisibilityQueryDTO[];
  onChange: (next: FiltersState) => void;
}

const selectStyle: React.CSSProperties = {
  height: 32,
  borderRadius: 7,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  fontSize: 12,
  padding: '0 8px',
  fontFamily: 'inherit',
};

const labelStyle: React.CSSProperties = { fontSize: 10.5, color: 'var(--sub)', fontWeight: 600 };

export function VisibilityFilters({ value, queries, onChange }: Props) {
  const set = (patch: Partial<FiltersState>) => onChange({ ...value, ...patch });

  return (
    <div className="card" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12, padding: '12px 16px' }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={labelStyle}>시장</span>
        <select style={selectStyle} value={value.market} onChange={(e) => set({ market: e.target.value as Market })}>
          {MARKETS.map((m) => (
            <option key={m} value={m}>{MARKET_LABELS[m]}</option>
          ))}
        </select>
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={labelStyle}>질문</span>
        <select
          style={{ ...selectStyle, maxWidth: 220 }}
          value={value.queryId ?? ''}
          onChange={(e) => set({ queryId: e.target.value || null })}
        >
          <option value="">전체 질문</option>
          {queries.map((q) => (
            <option key={q.id} value={q.id}>{q.query.length > 32 ? `${q.query.slice(0, 32)}…` : q.query}</option>
          ))}
        </select>
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={labelStyle}>엔진</span>
        <select
          style={selectStyle}
          value={value.engine ?? ''}
          onChange={(e) => set({ engine: (e.target.value || null) as EngineId | null })}
        >
          <option value="">전체 엔진</option>
          {ALL_ENGINES.map((en) => (
            <option key={en} value={en}>{ENGINE_LABELS[en]}</option>
          ))}
        </select>
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={labelStyle}>시작일</span>
        <input type="date" style={selectStyle} value={value.from} max={value.to} onChange={(e) => set({ from: e.target.value })} />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={labelStyle}>종료일</span>
        <input type="date" style={selectStyle} value={value.to} min={value.from} onChange={(e) => set({ to: e.target.value })} />
      </label>
    </div>
  );
}
