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
  /** Most-viewed GA4 pageTitle of the path (null when GA4 has none) — the human topic, unlike the path. */
  title: string | null;
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
  const range = { startDate: `${safeDays}daysAgo`, endDate: 'today' };
  const result = await runGa4(scope, key, range, async (client, property) => {
    // Intentional top-10: the explicit limit tells runGa4 this is not a truncated (partial) read.
    const [res] = await client.runReport({
      property,
      dateRanges: [range],
      dimensions: [{ name: 'pagePath' }],
      metrics: [{ name: 'sessions' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 10,
    });
    // Ranking and sessions come from pagePath alone (a path with many titles must not crowd others out — codex
    // review 2026-11-06); a second, bounded query picks each top path's most-viewed title.
    const top = (res.rows ?? []).slice(0, 10).map(row => ({ path: row.dimensionValues?.[0]?.value ?? '',
      sessions: Math.round(parseNum(row.metricValues?.[0]?.value)) })).filter(row => row.path);
    if (!top.length) return [];
    const [titles] = await client.runReport({
      property,
      dateRanges: [range],
      dimensions: [{ name: 'pagePath' }, { name: 'pageTitle' }],
      metrics: [{ name: 'sessions' }],
      dimensionFilter: { filter: { fieldName: 'pagePath', inListFilter: { values: top.map(t => t.path), caseSensitive: true } } },
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 100,
    });
    const titleOf = new Map<string, string>();
    for (const row of titles.rows ?? []) {
      const path = row.dimensionValues?.[0]?.value ?? '', title = row.dimensionValues?.[1]?.value ?? '';
      if (path && title && title !== '(not set)' && !titleOf.has(path)) titleOf.set(path, title);
    }
    return top.map(t => ({ ...t, title: titleOf.get(t.path) ?? null }));
  });
  return result;
}
