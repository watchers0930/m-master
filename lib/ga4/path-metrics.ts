import { getCached, getClient, getPropertyId, parseNum, safe, setCache, TTL, ymd } from './_internal';

export interface PathMetrics {
  sessions: number;
  screenPageViews: number;
  averageSessionDuration: number;
  bounceRate: number;
  engagementRate: number;
}

function emptyPathMetrics(): PathMetrics {
  return {
    sessions: 0,
    screenPageViews: 0,
    averageSessionDuration: 0,
    bounceRate: 0,
    engagementRate: 0,
  };
}

export async function fetchPathMetrics(pagePath: string, from: Date | string, to: Date | string): Promise<PathMetrics | null> {
  if (!pagePath || typeof pagePath !== 'string') return null;
  const startDate = typeof from === 'string' ? from : ymd(from);
  const endDate = typeof to === 'string' ? to : ymd(to);
  const key = `pathMetric:${pagePath}:${startDate}:${endDate}`;
  const cached = getCached<PathMetrics>(key);
  if (cached) return cached;
  const result = await safe(async () => {
    const client = getClient();
    const property = getPropertyId();
    const [res] = await client.runReport({
      property,
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'pagePath' }],
      metrics: [
        { name: 'sessions' },
        { name: 'screenPageViews' },
        { name: 'averageSessionDuration' },
        { name: 'bounceRate' },
        { name: 'engagementRate' },
      ],
      dimensionFilter: { filter: { fieldName: 'pagePath', stringFilter: { matchType: 'EXACT', value: pagePath } } },
    });
    const values = res.rows?.[0]?.metricValues ?? [];
    return {
      sessions: Math.round(parseNum(values[0]?.value)),
      screenPageViews: Math.round(parseNum(values[1]?.value)),
      averageSessionDuration: parseNum(values[2]?.value),
      bounceRate: parseNum(values[3]?.value),
      engagementRate: parseNum(values[4]?.value),
    };
  }, 'pathMetric', null as PathMetrics | null);
  if (result !== null) setCache(key, result, TTL.DETAIL);
  return result;
}

export async function fetchMultiplePathMetrics(paths: string[], from: Date | string, to: Date | string): Promise<Record<string, PathMetrics> | null> {
  if (paths.length === 0) return {};
  const startDate = typeof from === 'string' ? from : ymd(from);
  const endDate = typeof to === 'string' ? to : ymd(to);
  const key = `pathMulti:${paths.join(',')}:${startDate}:${endDate}`;
  const cached = getCached<Record<string, PathMetrics>>(key);
  if (cached) return cached;
  const result = await safe(async () => {
    const client = getClient();
    const property = getPropertyId();
    const output = Object.fromEntries(paths.map((entry) => [entry, emptyPathMetrics()])) as Record<string, PathMetrics>;
    const [res] = await client.runReport({
      property,
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'pagePath' }],
      metrics: [
        { name: 'sessions' },
        { name: 'screenPageViews' },
        { name: 'averageSessionDuration' },
        { name: 'bounceRate' },
        { name: 'engagementRate' },
      ],
      dimensionFilter: { filter: { fieldName: 'pagePath', inListFilter: { values: paths } } },
    });
    for (const row of res.rows ?? []) {
      const pagePath = row.dimensionValues?.[0]?.value ?? '';
      if (!output[pagePath]) continue;
      const values = row.metricValues ?? [];
      output[pagePath] = {
        sessions: Math.round(parseNum(values[0]?.value)),
        screenPageViews: Math.round(parseNum(values[1]?.value)),
        averageSessionDuration: parseNum(values[2]?.value),
        bounceRate: parseNum(values[3]?.value),
        engagementRate: parseNum(values[4]?.value),
      };
    }
    return output;
  }, 'pathMulti', null as Record<string, PathMetrics> | null);
  if (result !== null) setCache(key, result, TTL.DETAIL);
  return result;
}

export async function fetchMultiplePathSessionsByNaver(paths: string[], from: Date | string, to: Date | string): Promise<Record<string, number> | null> {
  if (paths.length === 0) return {};
  const startDate = typeof from === 'string' ? from : ymd(from);
  const endDate = typeof to === 'string' ? to : ymd(to);
  const key = `naverMulti:${paths.join(',')}:${startDate}:${endDate}`;
  const cached = getCached<Record<string, number>>(key);
  if (cached) return cached;
  const result = await safe(async () => {
    const client = getClient();
    const property = getPropertyId();
    const output = Object.fromEntries(paths.map((entry) => [entry, 0])) as Record<string, number>;
    const [res] = await client.runReport({
      property,
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'pagePath' }],
      metrics: [{ name: 'sessions' }],
      dimensionFilter: {
        andGroup: {
          expressions: [
            { filter: { fieldName: 'pagePath', inListFilter: { values: paths } } },
            { filter: { fieldName: 'sessionSource', stringFilter: { matchType: 'CONTAINS', value: 'naver', caseSensitive: false } } },
          ],
        },
      },
    });
    for (const row of res.rows ?? []) {
      const pagePath = row.dimensionValues?.[0]?.value ?? '';
      if (pagePath in output) output[pagePath] = Math.round(parseNum(row.metricValues?.[0]?.value));
    }
    return output;
  }, 'naverMulti', null as Record<string, number> | null);
  if (result !== null) setCache(key, result, TTL.DETAIL);
  return result;
}
