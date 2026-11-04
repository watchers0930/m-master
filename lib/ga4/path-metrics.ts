import type { Ga4Scope, Ga4Result } from '@/types/ga4';
import { runGa4 } from './run';
import { parseNum, ymd } from './_internal';

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

export async function fetchPathMetrics(pagePath: string, from: Date | string, to: Date | string, scope?: Ga4Scope): Promise<Ga4Result<PathMetrics>> {
  if (!pagePath || typeof pagePath !== 'string') return { status: 'error', code: 'invalid_query', retryable: false };
  const startDate = typeof from === 'string' ? from : ymd(from);
  const endDate = typeof to === 'string' ? to : ymd(to);
  const key = `pathMetric:${pagePath}:${startDate}:${endDate}`;
  const result = await runGa4(scope, key, { startDate, endDate }, async (client, property) => {
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
  });
  return result;
}

export async function fetchMultiplePathMetrics(paths: string[], from: Date | string, to: Date | string, scope?: Ga4Scope): Promise<Ga4Result<Record<string, PathMetrics>>> {

  const startDate = typeof from === 'string' ? from : ymd(from);
  const endDate = typeof to === 'string' ? to : ymd(to);
  const key = `pathMulti:${[...paths].sort().join(',')}:${startDate}:${endDate}`;
  const result = await runGa4(scope, key, { startDate, endDate }, async (client, property) => {
    if (!paths.length) return {};
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
  });
  return result;
}

export async function fetchMultiplePathSessionsByNaver(paths: string[], from: Date | string, to: Date | string, scope?: Ga4Scope): Promise<Ga4Result<Record<string, number>>> {

  const startDate = typeof from === 'string' ? from : ymd(from);
  const endDate = typeof to === 'string' ? to : ymd(to);
  const key = `naverMulti:${[...paths].sort().join(',')}:${startDate}:${endDate}`;
  const result = await runGa4(scope, key, { startDate, endDate }, async (client, property) => {
    if (!paths.length) return {};
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
  });
  return result;
}
