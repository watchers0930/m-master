'use client';

import { useState, useEffect } from 'react';
import { listSlots } from '@/lib/api/schedule';
import type { ScheduleSlot } from '@/types/db';

const CH_LABEL: Record<string, string> = { blog: '블로그', instagram: '인스타', facebook: '페북' };
const ST_COLOR: Record<string, { bg: string; color: string; border?: string }> = {
  scheduled:  { bg: 'var(--n100)',      color: 'var(--n500)' },
  published:  { bg: 'var(--blue-600)',  color: '#fff' },
  publishing: { bg: 'var(--amber-100)', color: 'var(--amber-700)' },
  failed:     { bg: '#fee2e2',          color: '#dc2626' },
  cancelled:  { bg: 'var(--n100)',      color: 'var(--n400)' },
  content:    { bg: '#fee2e2',          color: '#dc2626', border: '1px solid #fca5a5' },
};

interface Props {
  value: string | null;
  onChange: (date: string) => void;
}

export function ScheduleCalendarPicker({ value, onChange }: Props) {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);

  useEffect(() => {
    listSlots({ year, month }).then(r => setSlots(r.data ?? []));
  }, [year, month]);

  const prevMonth = () => { if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1); };

  const firstDay    = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const slotsByDate: Record<string, ScheduleSlot[]> = {};
  slots.forEach(s => {
    const d = s.scheduled_at.slice(0, 10);
    (slotsByDate[d] ??= []).push(s);
  });

  return (
    <>
      {/* 미니 달력 */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--surface)' }}>
        {/* 헤더 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderBottom: '1px solid var(--border)', background: 'var(--n50)' }}>
          <button type="button" onClick={prevMonth} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sub)', fontSize: 15, lineHeight: 1, padding: '0 4px' }}>‹</button>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--blue-700)' }}>{year}년 {month}월</span>
          <button type="button" onClick={nextMonth} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sub)', fontSize: 15, lineHeight: 1, padding: '0 4px' }}>›</button>
        </div>

        {/* 요일 헤더 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--border)' }}>
          {['일','월','화','수','목','금','토'].map((d, i) => (
            <div key={d} style={{ textAlign: 'center', fontSize: 9.5, fontWeight: 700, padding: '4px 0', color: i === 0 ? 'var(--amber-500)' : i === 6 ? 'var(--blue-400)' : 'var(--sub)' }}>{d}</div>
          ))}
        </div>

        {/* 날짜 그리드 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {cells.map((day, idx) => {
            if (!day) return <div key={`e-${idx}`} style={{ borderRight: '1px solid var(--border2)', borderBottom: '1px solid var(--border2)', minHeight: 36 }} />;
            const ds   = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
            const daySlots = slotsByDate[ds] ?? [];
            const isToday    = ds === todayStr;
            const isSelected = ds === value;
            const col = idx % 7;

            return (
              <div
                key={ds}
                onClick={() => onChange(ds)}
                style={{
                  borderRight: '1px solid var(--border2)', borderBottom: '1px solid var(--border2)',
                  padding: '3px 3px 4px', minHeight: 44, cursor: 'pointer',
                  background: isSelected ? 'var(--blue-50)' : 'transparent',
                  outline: isSelected ? '1.5px solid var(--blue-400)' : 'none',
                  outlineOffset: -1,
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--n50)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = isSelected ? 'var(--blue-50)' : ''; }}
              >
                {/* 날짜 숫자 */}
                <div style={{
                  width: 18, height: 18, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 600, marginBottom: 2,
                  background: isToday ? 'var(--blue-400)' : 'transparent',
                  color: isToday ? '#fff' : col === 0 ? 'var(--amber-500)' : col === 6 ? 'var(--blue-400)' : 'var(--text)',
                }}>{day}</div>

                {/* 슬롯 칩 (최대 2개) */}
                {daySlots.slice(0, 2).map(s => {
                  const st = s.content_id ? ST_COLOR.content : (ST_COLOR[s.status] ?? ST_COLOR.scheduled);
                  return (
                    <div key={s.id} style={{ fontSize: 9, fontWeight: 600, padding: '1px 4px', borderRadius: 3, marginBottom: 1, background: st.bg, color: st.color, border: st.border, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                      {CH_LABEL[s.channel] ?? s.channel}
                    </div>
                  );
                })}
                {daySlots.length > 2 && <div style={{ fontSize: 9, color: 'var(--sub)', paddingLeft: 2 }}>+{daySlots.length - 2}</div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* 선택된 날짜 표시 */}
      {value && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, padding: '5px 10px', borderRadius: 7, background: 'var(--blue-50)', border: '1px solid var(--blue-200)' }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--blue-700)' }}>📅 {value} 발행 예정</span>
          <button type="button" onClick={() => onChange('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sub)', fontSize: 14, lineHeight: 1 }}>×</button>
        </div>
      )}

    </>
  );
}
