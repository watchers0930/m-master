import type { Ga4Scope, Ga4Result } from '@/types/ga4';
import { runGa4 } from './run';
import { parseNum } from './_internal';

export interface DowChannelRow {
  dow: number;
  channel: string;
  sessions: number;
}

export interface PopularPage {
  path: string;
  sessions: number;
}

export async function fetchDowChannelPattern(scope?: Ga4Scope): Promise<Ga4Result<DowChannelRow[]>> {
  const key = 'pattern:';
  const result = await runGa4(scope, key, { startDate: '90daysAgo', endDate: 'today' }, async (client, property) => {
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
  });
  return result;
}

export async function fetchPopularPages(days = 30, scope?: Ga4Scope): Promise<Ga4Result<PopularPage[]>> {
  const safeDays = Math.max(1, Math.min(Math.floor(days), 365));
  const key = `popular:${safeDays}`;
  const result = await runGa4(scope, key, { startDate: '90daysAgo', endDate: 'today' }, async (client, property) => {
    const [res] = await client.runReport({
      property,
      dateRanges: [{ startDate: `${safeDays}daysAgo`, endDate: 'today' }],
      dimensions: [{ name: 'pagePath' }],
      metrics: [{ name: 'sessions' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    });
    return (res.rows ?? []).slice(0, 10)
      .map((row) => ({
        path: row.dimensionValues?.[0]?.value ?? '',
        sessions: Math.round(parseNum(row.metricValues?.[0]?.value)),
      }))
      .filter((row) => row.path);
  });
  return result;
}
