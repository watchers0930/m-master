import type { Ga4Scope, Ga4Result } from '@/types/ga4';
import { runGa4 } from './run';
import { kstNow, parseNum, ymd } from './_internal';

export async function fetchMonthlyVisitors(scope?: Ga4Scope): Promise<Ga4Result<number>> {
  const now = kstNow();
  const startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const key = 'monthlyVisitors:';
  const result = await runGa4(scope, key, { startDate, endDate: 'today' }, async (client, property) => {
    const [res] = await client.runReport({
      property,
      dateRanges: [{ startDate, endDate: 'today' }],
      metrics: [{ name: 'sessions' }],
    });
    return Math.round(parseNum(res.rows?.[0]?.metricValues?.[0]?.value));
  });
  return result;
}

export async function fetchMonthlyVisitorsPair(scope?: Ga4Scope): Promise<Ga4Result<{ thisMonth: number; lastMonth: number }>> {
    const now = kstNow();
    const thisStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const lastYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const lastMonth = now.getMonth() === 0 ? 12 : now.getMonth();
    const lastStart = `${lastYear}-${String(lastMonth).padStart(2, '0')}-01`;
    const lastEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  const key = 'monthlyVisitorsPair:';
  const result = await runGa4(scope, key, { startDate: lastStart, endDate: 'today' }, async (client, property) => {
    const [thisRes, lastRes] = await Promise.all([
      client.runReport({ property, dateRanges: [{ startDate: thisStart, endDate: 'today' }], metrics: [{ name: 'sessions' }] }),
      client.runReport({ property, dateRanges: [{ startDate: lastStart, endDate: ymd(lastEnd) }], metrics: [{ name: 'sessions' }] }),
    ]);
    return {
      thisMonth: Math.round(parseNum(thisRes[0]?.rows?.[0]?.metricValues?.[0]?.value)),
      lastMonth: Math.round(parseNum(lastRes[0]?.rows?.[0]?.metricValues?.[0]?.value)),
    };
  });
  return result;
}
