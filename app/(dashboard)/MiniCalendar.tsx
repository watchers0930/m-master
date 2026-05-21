'use client';

import Link from 'next/link';

interface MiniCalendarProps {
  year: number;
  month: number; // 1-indexed
  scheduledDates: string[]; // 'YYYY-MM-DD' 형식
}

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

export function MiniCalendar({ year, month, scheduledDates }: MiniCalendarProps) {
  const firstDay = new Date(year, month - 1, 1).getDay(); // 0=일
  const daysInMonth = new Date(year, month, 0).getDate();
  const today = new Date().toISOString().slice(0, 10);

  const scheduledSet = new Set(scheduledDates);

  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  // 6행 맞추기
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div>
      <div className="grid grid-cols-7 mb-1">
        {DAY_LABELS.map((d, i) => (
          <div
            key={d}
            className={[
              'text-center text-[10px] font-medium py-1',
              i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-[#8a9ab0]',
            ].join(' ')}
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((day, idx) => {
          if (day === null) return <div key={`empty-${idx}`} />;

          const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const isToday = dateStr === today;
          const hasSlot = scheduledSet.has(dateStr);
          const col = idx % 7;

          return (
            <Link href="/scheduler" key={dateStr}>
              <div
                className={[
                  'relative mx-auto flex h-7 w-7 items-center justify-center rounded-full text-[11px] transition-colors cursor-pointer',
                  isToday ? 'bg-[#1e3a5f] text-white font-bold' : 'hover:bg-[#e8edf4]',
                  col === 0 ? 'text-red-400' : col === 6 ? 'text-blue-400' : 'text-[#0f1923]',
                  isToday ? '!text-white' : '',
                ].join(' ')}
              >
                {day}
                {hasSlot && !isToday && (
                  <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-[#1e3a5f]" />
                )}
                {hasSlot && isToday && (
                  <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-white/70" />
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
