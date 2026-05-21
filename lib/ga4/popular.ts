import { getCached, getClient, getPropertyId, parseNum, safe, setCache, TTL } from './_internal';

export interface DowChannelRow {
  dow: number;
  channel: string;
  sessions: number;
}

export interface PopularPage {
  path: string;
  sessions: number;
}

export async function fetchDowChannelPattern(): Promise<DowChannelRow[] | null> {
  const key = 'pattern:';
  const cached = getCached<DowChannelRow[]>(key);
  if (cached) return cached;
  const result = await safe(async () => {
    const client = getClient();
    const property = getPropertyId();
    const [res] = await client.runReport({
      property,
      dateRanges: [{ startDate: '90daysAgo', endDate: 'today' }],
      dimensions: [{ name: 'dayOfWeek' }, { name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'sessions' }],
      orderBys: [{ dimension: { dimensionName: 'dayOfWeek' }, desc: false }],
    });
    return (res.rows ?? []).map((row) => ({
      dow: Math.round(parseNum(row.dimensionValues?.[0]?.value)),
      channel: row.dimensionValues?.[1]?.value ?? '(none)',
      sessions: Math.round(parseNum(row.metricValues?.[0]?.value)),
    }));
  }, 'pattern', null as DowChannelRow[] | null);
  if (result !== null) setCache(key, result, TTL.DETAIL);
  return result;
}

export async function fetchPopularPages(days = 30): Promise<PopularPage[] | null> {
  const safeDays = Math.max(1, Math.min(Math.floor(days), 365));
  const key = `popular:${safeDays}`;
  const cached = getCached<PopularPage[]>(key);
  if (cached) return cached;
  const result = await safe(async () => {
    const client = getClient();
    const property = getPropertyId();
    const [res] = await client.runReport({
      property,
      dateRanges: [{ startDate: `${safeDays}daysAgo`, endDate: 'today' }],
      dimensions: [{ name: 'pagePath' }],
      metrics: [{ name: 'sessions' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 10,
    });
    return (res.rows ?? [])
      .map((row) => ({
        path: row.dimensionValues?.[0]?.value ?? '',
        sessions: Math.round(parseNum(row.metricValues?.[0]?.value)),
      }))
      .filter((row) => row.path);
  }, 'popularPages', null as PopularPage[] | null);
  if (result !== null) setCache(key, result, TTL.DETAIL);
  return result;
}
