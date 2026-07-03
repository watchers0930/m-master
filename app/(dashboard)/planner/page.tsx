'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getCalendar, deletePublishJob } from '@/lib/api/editor';
import type { CalendarEntry } from '@/types/editor';

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

const PUBLISH_STATUS: Record<string, { label: string; color: string; bg: string; border: string }> = {
  pending:    { label: '발행 예정', color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
  processing: { label: '발행 중',   color: '#f97316', bg: '#fff7ed', border: '#fed7aa' },
  done:       { label: '발행 완료', color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' },
  failed:     { label: '실패',      color: '#ef4444', bg: '#fef2f2', border: '#fecaca' },
};

const CHANNEL_ICON: Record<string, string> = {
  blog: '📝', instagram: '📸', facebook: '👥', naver_cafe: '☕',
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

  const loadCalendar = useCallback(async () => {
    setLoading(true);
    const { data } = await getCalendar(year, month);
    // publish 항목만 표시
    setEntries((data ?? []).filter(e => e.kind === 'publish'));
    setLoading(false);
  }, [year, month]);

  useEffect(() => { loadCalendar(); }, [loadCalendar]);

  const goPrev = () => month === 1 ? (setYear(y => y - 1), setMonth(12)) : setMonth(m => m - 1);
  const goNext = () => month === 12 ? (setYear(y => y + 1), setMonth(1)) : setMonth(m => m + 1);

  const handleDeleteJob = async (id: string) => {
    if (!confirm('발행 예정일을 삭제할까요?')) return;
    await deletePublishJob(id);
    loadCalendar();
  };

  const cells = buildCalGrid(year, month);
  const todayStr = toDateStr(today.getFullYear(), today.getMonth() + 1, today.getDate());

  const entriesByDate = entries.reduce<Record<string, CalendarEntry[]>>((acc, e) => {
    (acc[e.date] ??= []).push(e);
    return acc;
  }, {});

  const publishCount = entries.length;
  const doneCount = entries.filter(e => e.status === 'done').length;

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            총 {publishCount}건 · 완료 {doneCount}건
          </div>
          <button
            onClick={() => router.push('/editor/new')}
            style={{ padding: '7px 14px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            + 새 문서
          </button>
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
              </div>

              {/* 발행 예정 항목들 */}
              {dayEntries.map(e => {
                const ps = PUBLISH_STATUS[e.status] ?? PUBLISH_STATUS.pending;
                const icon = CHANNEL_ICON[e.channel ?? ''] ?? '📄';
                return (
                  <div key={e.id} style={{ background: ps.bg, border: `1px solid ${ps.border}`, borderRadius: 6, padding: '3px 6px', fontSize: 11 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 10, flexShrink: 0 }}>{icon}</span>
                      <span
                        style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: ps.color, fontWeight: 600, cursor: 'pointer' }}
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
              })}
            </div>
          );
        })}
      </div>

      {loading && (
        <div style={{ position: 'fixed', bottom: 20, right: 20, background: '#1e293b', color: '#fff', padding: '8px 16px', borderRadius: 8, fontSize: 12 }}>
          불러오는 중...
        </div>
      )}
    </div>
  );
}
