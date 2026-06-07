'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';

interface CalendarSlot {
  id: string;
  channel: string;
  status: string;
  scheduled_at: string;
  mode: string;
  content_id: string | null;
  topic: string;
}

const CH_LABEL: Record<string, string> = { blog: '블로그', instagram: '인스타', facebook: '페북' };
const ST_LABEL: Record<string, string> = { scheduled: '예약', publishing: '발행중', published: '완료', failed: '실패', cancelled: '취소' };

function chipClass(slot: CalendarSlot) {
  const ch = CH_LABEL[slot.channel] ?? slot.channel;
  const st = ST_LABEL[slot.status] ?? slot.status;
  const label = slot.mode === 'ai_auto' && slot.status !== 'published'
    ? `${ch} · AI편성`
    : `${ch} · ${st}`;

  if (slot.status === 'published') return { chip: 'ch-done',    dot: 'dot-done',    label };
  if (slot.content_id)             return { chip: 'ch-content', dot: 'dot-content', label };
  if (slot.mode === 'ai_auto')     return { chip: 'ch-ai',      dot: 'dot-ai',      label };
  if (slot.channel === 'blog')      return { chip: 'ch-blog',    dot: 'dot-blog',    label };
  if (slot.channel === 'instagram') return { chip: 'ch-insta',   dot: 'dot-insta',   label };
  return                                   { chip: 'ch-fb',      dot: 'dot-fb',      label };
}

/** UTC ISO 문자열 → KST 날짜 문자열 (YYYY-MM-DD) */
function toKSTDate(iso: string): string {
  const d = new Date(iso);
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function buildCells(year: number, month: number, slots: CalendarSlot[]) {
  const firstDay = new Date(year, month - 1, 1).getDay();
  const lastDate = new Date(year, month, 0).getDate();
  const prevLast = new Date(year, month - 1, 0).getDate();
  const todayStr = toKSTDate(new Date().toISOString());
  const cells: { date: number; current: boolean; col: number; slots: CalendarSlot[]; isToday: boolean }[] = [];

  const push = (date: number, current: boolean, daySlots: CalendarSlot[], isToday: boolean) =>
    cells.push({ date, current, col: cells.length % 7, slots: daySlots, isToday });

  for (let i = firstDay - 1; i >= 0; i--) push(prevLast - i, false, [], false);
  for (let d = 1; d <= lastDate; d++) {
    const ds = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    push(d, true, slots.filter(s => toKSTDate(s.scheduled_at) === ds), ds === todayStr);
  }
  let n = 1;
  while (cells.length % 7 !== 0 || cells.length < 35) push(n++, false, [], false);
  return cells;
}

export function DashboardCalendar() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const [slots, setSlots] = useState<CalendarSlot[]>([]);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/schedule/slots?year=${year}&month=${month}`)
      .then(res => res.json())
      .then(res => {
        const raw = res.data ?? [];
        // Prisma camelCase → component snake_case 매핑
        setSlots(raw.map((s: Record<string, unknown>) => ({
          id: s.id,
          channel: s.channel,
          status: s.status,
          scheduled_at: s.scheduledAt ?? s.scheduled_at ?? '',
          mode: s.mode,
          content_id: s.contentId ?? s.content_id ?? null,
          topic: (s.content as Record<string, unknown>)?.topic ?? s.topic ?? '',
        })));
      })
      .catch(() => {});
  }, [year, month]);

  const handleToggle = async (slot: CalendarSlot) => {
    if (togglingId) return;
    const nextStatus = slot.status === 'published' ? 'scheduled' : 'published';
    setTogglingId(slot.id);
    try {
      const res = await fetch(`/api/schedule/slot/${slot.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (res.ok) {
        setSlots(prev => prev.map(s => s.id === slot.id ? { ...s, status: nextStatus } : s));
      }
    } catch { /* silent */ }
    setTogglingId(null);
  };

  const cells = buildCells(year, month, slots);
  const published = slots.filter(s => s.status === 'published').length;
  const scheduled = slots.filter(s => s.status === 'scheduled').length;

  return (
    <div className="card">
      <div className="card-head">
        <svg className="icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
          <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
        </svg>
        <span className="card-title">{year}년 {month}월 콘텐츠 현황</span>
        <Link href="/scheduler" style={{fontSize:11,color:'var(--c400)',marginLeft:'auto'}}>스케줄러 →</Link>
      </div>

      <div className="cal-body">
        <div className="cal-dow">
          {['일','월','화','수','목','금','토'].map((d,i) => (
            <div key={d} className={`dow-cell${i===0?' sun':i===6?' sat':''}`}>{d}</div>
          ))}
        </div>
        <div className="cal-grid">
          {cells.map((cell, idx) => (
            <div
              key={idx}
              className={[
                'c-cell',
                !cell.current ? 'dim' : '',
                cell.isToday ? 'today' : '',
                cell.col === 0 ? 'sun' : '',
                cell.col === 6 ? 'sat' : '',
              ].filter(Boolean).join(' ')}
            >
              <div className="c-date">{cell.date}</div>
              <div className="chip-stack">
                {cell.slots.map(slot => {
                  const { chip, dot, label } = chipClass(slot);
                  const isToggling = togglingId === slot.id;
                  return (
                    <div
                      key={slot.id}
                      className={`chip ${chip}`}
                      onClick={() => handleToggle(slot)}
                      style={{ cursor: isToggling ? 'wait' : 'pointer', opacity: isToggling ? 0.6 : 1 }}
                      title={slot.status === 'published' ? '클릭 시 예약으로 변경' : '클릭 시 완료로 변경'}
                    >
                      <span className={`chip-dot ${dot}`}></span>{label}
                    </div>
                  );
                })}
              </div>
              {cell.current && cell.slots.length === 0 && <div className="add-btn"></div>}
            </div>
          ))}
        </div>
      </div>

      <div className="cal-foot">
        <div className="legend"><span className="leg-dot" style={{background:'#2563EB'}}></span>블로그</div>
        <div className="legend"><span className="leg-dot" style={{background:'#60A5FA'}}></span>인스타</div>
        <div className="legend"><span className="leg-dot" style={{background:'#122556'}}></span>페이스북</div>
        <div className="legend"><span className="leg-dot" style={{background:'#B45309'}}></span>AI 편성</div>
        <div className="legend"><span className="leg-dot" style={{background:'#C8D5E8'}}></span>완료</div>
        <div className="cal-stats">
          <div className="cs-item"><div className="cs-n" style={{color:'var(--sub)'}}>{published}</div><div className="cs-l">완료</div></div>
          <div className="cs-item"><div className="cs-n">{scheduled}</div><div className="cs-l">예약</div></div>
        </div>
      </div>
    </div>
  );
}
