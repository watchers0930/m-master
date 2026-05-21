import { getCached, getClient, getPropertyId, kstNow, parseNum, safe, setCache, TTL, ymd } from './_internal';

export async function fetchMonthlyVisitors(): Promise<number | null> {
  const key = 'monthlyVisitors:';
  const cached = getCached<number>(key);
  if (cached !== undefined) return cached;
  const result = await safe(async () => {
    const client = getClient();
    const property = getPropertyId();
    const now = kstNow();
    const startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const [res] = await client.runReport({
      property,
      dateRanges: [{ startDate, endDate: 'today' }],
      metrics: [{ name: 'sessions' }],
    });
    return Math.round(parseNum(res.rows?.[0]?.metricValues?.[0]?.value));
  }, 'monthlyVisitors', null as number | null);
  if (result !== null) setCache(key, result, TTL.OVERVIEW);
  return result;
}

export async function fetchMonthlyVisitorsPair(): Promise<{ thisMonth: number; lastMonth: number } | null> {
  const key = 'monthlyVisitorsPair:';
  const cached = getCached<{ thisMonth: number; lastMonth: number }>(key);
  if (cached) return cached;
  const result = await safe(async () => {
    const client = getClient();
    const property = getPropertyId();
    const now = kstNow();
    const thisStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const lastYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const lastMonth = now.getMonth() === 0 ? 12 : now.getMonth();
    const lastStart = `${lastYear}-${String(lastMonth).padStart(2, '0')}-01`;
    const lastEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    const [thisRes, lastRes] = await Promise.all([
      client.runReport({ property, dateRanges: [{ startDate: thisStart, endDate: 'today' }], metrics: [{ name: 'sessions' }] }),
      client.runReport({ property, dateRanges: [{ startDate: lastStart, endDate: ymd(lastEnd) }], metrics: [{ name: 'sessions' }] }),
    ]);
    return {
      thisMonth: Math.round(parseNum(thisRes[0]?.rows?.[0]?.metricValues?.[0]?.value)),
      lastMonth: Math.round(parseNum(lastRes[0]?.rows?.[0]?.metricValues?.[0]?.value)),
    };
  }, 'monthlyVisitorsPair', null as { thisMonth: number; lastMonth: number } | null);
  if (result !== null) setCache(key, result, TTL.OVERVIEW);
  return result;
}
