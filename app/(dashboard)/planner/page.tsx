'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getCalendar, createPlanItem, updatePlanItem, deletePlanItem, deletePublishJob } from '@/lib/api/editor';
import type { CalendarEntry, IdeaScheduleCategory } from '@/types/editor';

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

const CAT_COLOR: Record<IdeaScheduleCategory, string> = {
  general: '#6b7280', blog: '#2563eb', youtube: '#dc2626',
};

const PLAN_STATUS: Record<string, { bg: string; border: string; text: string; label: string }> = {
  planned:     { bg: 'rgba(0,0,0,.04)',  border: '#e5e7eb', text: '#6b7280', label: '계획' },
  in_progress: { bg: '#fff7ed',          border: '#fed7aa', text: '#c2410c', label: '진행중' },
  completed:   { bg: '#f0fdf4',          border: '#bbf7d0', text: '#16a34a', label: '완료' },
};

const PUBLISH_STATUS: Record<string, { label: string; color: string }> = {
  pending:    { label: '예약 대기', color: '#2563eb' },
  processing: { label: '발행 중',   color: '#f97316' },
  done:       { label: '발행 완료', color: '#16a34a' },
  failed:     { label: '실패',      color: '#ef4444' },
};

function buildCalGrid(year: number, month: number) {
  const first = new Date(year, month - 1, 1).getDay();
  const days = new Date(year, month, 0).getDate();
  const cells: (number | null)[] = Array(first).fill(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function toDateStr(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export default function PlannerPage() {
  const router = useRouter();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [addModal, setAddModal] = useState<{ date: string } | null>(null);
  const [addTitle, setAddTitle] = useState('');
  const [addCategory, setAddCategory] = useState<IdeaScheduleCategory>('general');

  const loadCalendar = useCallback(async () => {
    setLoading(true);
    const { data } = await getCalendar(year, month);
    setEntries(data ?? []);
    setLoading(false);
  }, [year, month]);

  useEffect(() => { loadCalendar(); }, [loadCalendar]);

  const goPrev = () => month === 1 ? (setYear(y => y - 1), setMonth(12)) : setMonth(m => m - 1);
  const goNext = () => month === 12 ? (setYear(y => y + 1), setMonth(1)) : setMonth(m => m + 1);

  const handleAddPlan = async () => {
    if (!addTitle.trim() || !addModal) return;
    await createPlanItem({ title: addTitle, scheduledDate: addModal.date, category: addCategory });
    setAddModal(null); setAddTitle(''); setAddCategory('general');
    loadCalendar();
  };

  const cyclePlanStatus = async (id: string, status: string) => {
    const cycle: Record<string, string> = { planned: 'in_progress', in_progress: 'completed', completed: 'planned' };
    await updatePlanItem(id, { status: cycle[status] ?? 'planned' });
    loadCalendar();
  };

  const handleDeletePlan = async (id: string) => {
    await deletePlanItem(id);
    loadCalendar();
  };

  const handleDeleteJob = async (id: string) => {
    if (!confirm('발행 예약을 삭제할까요? (발행된 글은 유지됩니다)')) return;
    await deletePublishJob(id);
    loadCalendar();
  };

  const cells = buildCalGrid(year, month);
  const todayStr = toDateStr(today.getFullYear(), today.getMonth() + 1, today.getDate());

  const entriesByDate = entries.reduce<Record<string, CalendarEntry[]>>((acc, e) => {
    (acc[e.date] ??= []).push(e);
    return acc;
  }, {});

  return (
    <div style={{ padding: '24px 28px', height: 'calc(100vh - 52px)', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={goPrev} style={{ width: 30, height: 30, border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 14 }}>‹</button>
          <h1 style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', minWidth: 120, textAlign: 'center' }}>
            {year}년 {month}월
          </h1>
          <button onClick={goNext} style={{ width: 30, height: 30, border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 14 }}>›</button>
        </div>
        <div style={{ fontSize: 12, color: '#64748b' }}>
          계획 {entries.filter(e => e.kind === 'plan').length}건 · 예약 {entries.filter(e => e.kind === 'publish').length}건
        </div>
      </div>

      {/* 요일 헤더 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,minmax(0,1fr))', gap: 6 }}>
        {DOW.map((d, i) => (
          <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: i === 0 ? '#ef4444' : i === 6 ? '#3b82f6' : '#64748b', padding: '4px 0' }}>
            {d}
          </div>
        ))}
      </div>

      {/* 달력 그리드 */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(7,minmax(0,1fr))', gap: 6, overflow: 'auto' }}>
        {cells.map((day, idx) => {
          if (!day) return <div key={`empty-${idx}`} style={{ background: '#f8fafc', borderRadius: 10, border: '1px dashed #e2e8f0' }} />;
          const dateStr = toDateStr(year, month, day);
          const isToday = dateStr === todayStr;
          const dayEntries = entriesByDate[dateStr] ?? [];
          const dow = new Date(year, month - 1, day).getDay();

          return (
            <div key={dateStr}
              style={{ minHeight: 110, border: `1px solid ${isToday ? '#2563eb' : '#e2e8f0'}`, borderRadius: 10, padding: '6px 7px', background: isToday ? '#eff6ff' : '#fff', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {/* 날짜 */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{
                  width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700,
                  background: isToday ? '#2563eb' : 'transparent',
                  color: isToday ? '#fff' : dow === 0 ? '#ef4444' : dow === 6 ? '#3b82f6' : '#374151',
                }}>
                  {day}
                </span>
                <button
                  onClick={() => { setAddModal({ date: dateStr }); setAddTitle(''); }}
                  style={{ width: 18, height: 18, borderRadius: '50%', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', lineHeight: 1 }}>
                  +
                </button>
              </div>

              {/* 항목들 */}
              {dayEntries.map(e => {
                if (e.kind === 'plan') {
                  const s = PLAN_STATUS[e.status] ?? PLAN_STATUS.planned;
                  return (
                    <div key={e.id} style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 6, padding: '3px 6px', fontSize: 11 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: CAT_COLOR[e.category ?? 'general'], flexShrink: 0 }} />
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: s.text, fontWeight: 600, cursor: 'pointer' }}
                          onClick={() => cyclePlanStatus(e.id, e.status)}>
                          {e.title}
                        </span>
                        <button onClick={() => handleDeletePlan(e.id)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 11, padding: 0, lineHeight: 1 }}>×</button>
                      </div>
                    </div>
                  );
                } else {
                  const ps = PUBLISH_STATUS[e.status] ?? PUBLISH_STATUS.pending;
                  return (
                    <div key={e.id} style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 6, padding: '3px 6px', fontSize: 11 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontSize: 10 }}>📤</span>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: ps.color, fontWeight: 600, cursor: 'pointer' }}
                          onClick={() => {
                            if (e.status === 'done' && e.externalUrl) window.open(e.externalUrl, '_blank');
                            else if (e.docId) router.push(`/editor/${e.docId}`);
                          }}>
                          {e.title}
                        </span>
                        <button onClick={() => handleDeleteJob(e.id)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 11, padding: 0, lineHeight: 1 }}>×</button>
                      </div>
                      <div style={{ fontSize: 10, color: ps.color, marginTop: 1 }}>{ps.label}</div>
                    </div>
                  );
                }
              })}
            </div>
          );
        })}
      </div>

      {/* 계획 추가 모달 */}
      {addModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: 340, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>계획 추가 — {addModal.date}</h3>
            <input value={addTitle} onChange={e => setAddTitle(e.target.value)}
              placeholder="제목"
              onKeyDown={e => e.key === 'Enter' && handleAddPlan()}
              style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '9px 12px', fontSize: 13, outline: 'none' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              {(['general', 'blog', 'youtube'] as IdeaScheduleCategory[]).map(c => (
                <button key={c} onClick={() => setAddCategory(c)}
                  style={{ flex: 1, padding: '7px 0', border: `2px solid ${addCategory === c ? CAT_COLOR[c] : '#e2e8f0'}`, borderRadius: 8, background: addCategory === c ? CAT_COLOR[c] + '15' : '#fff', color: addCategory === c ? CAT_COLOR[c] : '#64748b', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  {c === 'general' ? '일반' : c === 'blog' ? '블로그' : '유튜브'}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setAddModal(null)}
                style={{ padding: '8px 16px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>취소</button>
              <button onClick={handleAddPlan} disabled={!addTitle.trim()}
                style={{ padding: '8px 16px', background: addTitle.trim() ? '#2563eb' : '#e2e8f0', color: addTitle.trim() ? '#fff' : '#94a3b8', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: addTitle.trim() ? 'pointer' : 'not-allowed' }}>
                추가
              </button>
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div style={{ position: 'fixed', bottom: 20, right: 20, background: '#1e293b', color: '#fff', padding: '8px 16px', borderRadius: 8, fontSize: 12 }}>
          불러오는 중...
        </div>
      )}
    </div>
  );
}
