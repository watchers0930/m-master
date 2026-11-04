export type Period = '7d' | '30d' | '90d' | '365d' | 'today' | 'yesterday' | 'this_week' | 'this_month';
export interface DimensionValue {
  value?: string | null;
}

export interface MetricValue {
  value?: string | null;
}

export interface ReportRow {
  dimensionValues?: DimensionValue[] | null;
  metricValues?: MetricValue[] | null;
}


export function kstNow(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

export function parseNum(v: string | null | undefined) {
  return parseFloat(v ?? '0') || 0;
}

export function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export { toYMD as ymd };

export function periodToDates(period: Period) {
  switch (period) {
    case 'today':
      return { startDate: 'today', endDate: 'today' };
    case 'yesterday':
      return { startDate: 'yesterday', endDate: 'yesterday' };
    case 'this_week': {
      const now = kstNow();
      const diff = now.getDay() === 0 ? 6 : now.getDay() - 1;
      const mon = new Date(now);
      mon.setDate(now.getDate() - diff);
      return { startDate: toYMD(mon), endDate: 'today' };
    }
    case 'this_month': {
      const now = kstNow();
      return { startDate: toYMD(new Date(now.getFullYear(), now.getMonth(), 1)), endDate: 'today' };
    }
    case '7d':
      return { startDate: '7daysAgo', endDate: 'today' };
    case '30d':
      return { startDate: '30daysAgo', endDate: 'today' };
    case '90d':
      return { startDate: '90daysAgo', endDate: 'today' };
    case '365d':
      return { startDate: '365daysAgo', endDate: 'today' };
  }
}

export function prevPeriodDates(period: Period) {
  switch (period) {
    case 'today':
      return { startDate: 'yesterday', endDate: 'yesterday' };
    case 'yesterday': {
      const now = kstNow();
      const twoDaysAgo = new Date(now);
      twoDaysAgo.setDate(now.getDate() - 2);
      return { startDate: toYMD(twoDaysAgo), endDate: toYMD(twoDaysAgo) };
    }
    case 'this_week': {
      const now = kstNow();
      const diff = now.getDay() === 0 ? 6 : now.getDay() - 1;
      const mon = new Date(now);
      mon.setDate(now.getDate() - diff);
      const prevMon = new Date(mon);
      prevMon.setDate(mon.getDate() - 7);
      const prevSun = new Date(prevMon);
      prevSun.setDate(prevMon.getDate() + 6);
      return { startDate: toYMD(prevMon), endDate: toYMD(prevSun) };
    }
    case 'this_month': {
      const now = kstNow();
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return { startDate: toYMD(first), endDate: toYMD(last) };
    }
    case '7d':
      return { startDate: '14daysAgo', endDate: '8daysAgo' };
    case '30d':
      return { startDate: '60daysAgo', endDate: '31daysAgo' };
    case '90d':
      return { startDate: '180daysAgo', endDate: '91daysAgo' };
    case '365d':
      return { startDate: '730daysAgo', endDate: '366daysAgo' };
  }
}

export function calcDelta(cur: number, prev: number): number {
  if (prev === 0) return cur > 0 ? 100 : 0;
  return ((cur - prev) / prev) * 100;
}


export { invalidateGa4Credentials as invalidateDbCredentials } from "./auth";
