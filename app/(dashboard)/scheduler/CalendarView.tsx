'use client';

import { useState } from 'react';
import type { ScheduleSlot } from '@/types/db';
import { createSlot, deleteSlot } from '@/lib/api/schedule';

interface CalendarViewProps {
  year: number;
  month: number;
  slots: ScheduleSlot[];
  onSlotsChange: (slots: ScheduleSlot[]) => void;
}

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

const STATUS_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  scheduled:  { bg: 'var(--blue-100)',   color: 'var(--blue-600)',   border: 'var(--blue-200)' },
  publishing: { bg: 'var(--amber-100)',  color: 'var(--amber-700)', border: '#fde68a' },
  published:  { bg: 'var(--green-100)',  color: 'var(--green-700)', border: '#bbf7d0' },
  failed:     { bg: '#fee2e2',           color: '#dc2626',           border: '#fecaca' },
  cancelled:  { bg: 'var(--n100)',       color: 'var(--n400)',       border: 'var(--border)' },
};

const STATUS_LABEL: Record<string, string> = {
  scheduled: '예약', publishing: '발행중', published: '완료', failed: '실패', cancelled: '취소',
};

const CH_LABEL: Record<string, string> = { blog: '블로그', instagram: '인스타', facebook: '페북' };

const fieldStyle: React.CSSProperties = {
  width: '100%', borderRadius: 7, border: '1px solid var(--border)',
  background: 'var(--surface)', padding: '8px 11px', fontSize: 12.5,
  color: 'var(--text)', outline: 'none', fontFamily: 'inherit',
};

export function CalendarView({ year, month, slots, onSlotsChange }: CalendarViewProps) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [contentId, setContentId] = useState('');
  const [timeStr, setTimeStr] = useState('09:00');
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const today = new Date().toISOString().slice(0, 10);

  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const slotsByDate: Record<string, ScheduleSlot[]> = {};
  slots.forEach((s) => {
    const d = s.scheduled_at.slice(0, 10);
    if (!slotsByDate[d]) slotsByDate[d] = [];
    slotsByDate[d].push(s);
  });

  const handleDayClick = (day: number) => {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    setSelectedDate(dateStr);
    setAddOpen(true);
  };

  const handleAdd = async () => {
    if (!selectedDate || !contentId.trim()) return;
    setAdding(true);
    const scheduledAt = `${selectedDate}T${timeStr}:00Z`;
    const res = await createSlot({ content_id: contentId.trim(), channel: 'blog', scheduled_at: scheduledAt });
    setAdding(false);
    if (res.data) {
      const newSlot: ScheduleSlot = {
        id: res.data.slot_id, content_id: contentId.trim(), channel: 'blog',
        scheduled_at: scheduledAt, published_at: null, status: 'scheduled',
        mode: 'manual', external_id: null, external_url: null,
        retry_count: 0, last_error: null, created_at: new Date().toISOString(),
      };
      onSlotsChange([...slots, newSlot]);
      setAddOpen(false);
      setContentId('');
      setTimeStr('09:00');
    }
  };

  const handleDelete = async (slotId: string) => {
    setDeletingId(slotId);
    await deleteSlot(slotId);
    onSlotsChange(slots.filter((s) => s.id !== slotId));
    setDeletingId(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 요일 헤더 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        {DAY_LABELS.map((d, i) => (
          <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, padding: '8px 0', color: i === 0 ? 'var(--amber-500)' : i === 6 ? 'var(--blue-400)' : 'var(--sub)' }}>
            {d}
          </div>
        ))}
      </div>

      {/* 날짜 그리드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridAutoRows: '1fr', flex: 1, minHeight: 0 }}>
        {cells.map((day, idx) => {
          if (day === null) {
            return <div key={`e-${idx}`} style={{ borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }} />;
          }
          const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const daySlots = slotsByDate[dateStr] ?? [];
          const isToday = dateStr === today;
          const col = idx % 7;

          return (
            <div
              key={dateStr}
              onClick={() => handleDayClick(day)}
              style={{ borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)', padding: 4, cursor: 'pointer', transition: 'background 0.1s' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--blue-50)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '')}
            >
              <div style={{ display: 'inline-flex', width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: '50%', fontSize: 11, fontWeight: 600, marginBottom: 2, background: isToday ? 'var(--blue-400)' : 'transparent', color: isToday ? '#fff' : col === 0 ? 'var(--amber-500)' : col === 6 ? 'var(--blue-400)' : 'var(--text)' }}>
                {day}
              </div>
              {daySlots.slice(0, 2).map((s) => {
                const st = STATUS_STYLE[s.status] ?? STATUS_STYLE.cancelled;
                return (
                  <div key={s.id} onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, borderRadius: 3, border: `1px solid ${st.border}`, background: st.bg, color: st.color, fontSize: 11, fontWeight: 600, padding: '3px 6px', marginBottom: 2 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{CH_LABEL[s.channel] ?? s.channel} · {STATUS_LABEL[s.status]}</span>
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }} disabled={deletingId === s.id} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, fontSize: 12, lineHeight: 1, opacity: 0.7 }}>×</button>
                  </div>
                );
              })}
              {daySlots.length > 2 && <p style={{ fontSize: 11, color: 'var(--sub)', padding: '0 2px' }}>+{daySlots.length - 2}개</p>}
            </div>
          );
        })}
      </div>

      {/* 슬롯 추가 모달 */}
      {addOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setAddOpen(false)}>
          <div style={{ background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border)', width: 360, boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>편성 추가 — {selectedDate}</span>
              <button onClick={() => setAddOpen(false)} style={{ background: 'none', border: 'none', fontSize: 18, color: 'var(--sub)', cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>
            <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--sub)', display: 'block', marginBottom: 4 }}>콘텐츠 ID *</label>
                <input style={fieldStyle} placeholder="생성된 콘텐츠 ID 입력" value={contentId} onChange={(e) => setContentId(e.target.value)} />
                <p style={{ fontSize: 10, color: 'var(--sub)', marginTop: 3 }}>콘텐츠 생성 후 ID를 복사해 붙여넣기 하세요</p>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--sub)', display: 'block', marginBottom: 4 }}>발행 시각</label>
                <input type="time" style={fieldStyle} value={timeStr} onChange={(e) => setTimeStr(e.target.value)} />
              </div>
              <p style={{ fontSize: 11, color: 'var(--sub)' }}>채널: 블로그 (Phase 1 고정) · 수동 편성</p>
            </div>
            <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setAddOpen(false)} className="btn btn-ghost" style={{ fontSize: 12 }}>취소</button>
              <button onClick={handleAdd} disabled={adding} className="btn btn-primary" style={{ fontSize: 12, opacity: adding ? 0.7 : 1 }}>{adding ? '추가 중...' : '추가'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
