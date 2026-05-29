// lib/topics/week-utils.ts — 주간 토픽 생성용 날짜 유틸 (KST 기준)

/**
 * KST 기준 현재 시각의 Date 객체 반환
 * (UTC + 9시간 보정, toISOString()으로 날짜 추출 시 KST 날짜가 됨)
 */
function kstDate(): Date {
  const now = new Date();
  return new Date(now.getTime() + 9 * 60 * 60 * 1000);
}

/**
 * 주어진 날짜(YYYY-MM-DD)의 해당 주 월요일을 반환 (ISO 8601 기준)
 * KST 기준 동작
 */
export function getMondayOfWeekKST(dateStr?: string): string {
  const d = dateStr
    ? new Date(`${dateStr}T00:00:00Z`)
    : kstDate();
  const day = d.getUTCDay(); // 0=일, 1=월, ..., 6=토
  const diff = day === 0 ? -6 : 1 - day; // 일요일이면 -6, 나머지는 1-day
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

/**
 * 주어진 월요일(weekStart)로부터 월~일 7일의 날짜 배열 반환
 * @returns ['YYYY-MM-DD', ...] 7개
 */
export function getWeekdayDates(weekStart: string): string[] {
  const d = new Date(`${weekStart}T00:00:00Z`);
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const cur = new Date(d.getTime() + i * 24 * 60 * 60 * 1000);
    dates.push(cur.toISOString().slice(0, 10));
  }
  return dates;
}

/**
 * KST 기준 오늘이 평일(월~금)인지 확인
 */
export function isWeekdayKST(dateStr?: string): boolean {
  const d = dateStr
    ? new Date(`${dateStr}T00:00:00Z`)
    : kstDate();
  const day = d.getUTCDay();
  return day >= 1 && day <= 5;
}

/**
 * KST 기준 오늘이 월요일인지 확인
 */
export function isMondayKST(dateStr?: string): boolean {
  const d = dateStr
    ? new Date(`${dateStr}T00:00:00Z`)
    : kstDate();
  return d.getUTCDay() === 1;
}
