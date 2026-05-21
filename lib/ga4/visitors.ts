import { calcDelta, getCached, getClient, getPropertyId, parseNum, periodToDates, prevPeriodDates, safe, setCache, TTL } from './_internal';
import type { Period } from './_internal';
import type { ReportRow } from './_internal';

export type { Period } from './_internal';

export interface OverviewKpi {
  sessions: number;
  sessionsDelta: number;
  activeUsers: number;
  activeUsersDelta: number;
  newUsers: number;
  newUsersDelta: number;
  pageViews: number;
  pageViewsDelta: number;
  bounceRate: number;
  bounceRateDelta: number;
  avgSessionDuration: number;
  avgSessionDurationDelta: number;
  engagementRate: number;
  engagementRateDelta: number;
  eventsPerSession: number;
}

export interface TrafficSource {
  channel: string;
  sessions: number;
  percentage: number;
}

export interface DailyPoint {
  date: string;
  views: number;
  sessions: number;
}

export interface TopPage {
  path: string;
  title: string;
  views: number;
  avgTimeOnPage: number;
  bounceRate: number;
}

export interface ReferralSource {
  source: string;
  medium: string;
  sessions: number;
  percentage: number;
}

export interface SearchTermRow {
  term: string;
  sessions: number;
}

export interface AgeGroup {
  bracket: string;
  users: number;
  percentage: number;
}

export interface GenderRow {
  gender: string;
  users: number;
  percentage: number;
}

export interface CityRow {
  city: string;
  users: number;
  percentage: number;
}

export interface CountryRow {
  country: string;
  users: number;
  percentage: number;
}

export interface DeviceRow {
  device: string;
  sessions: number;
  percentage: number;
}

export interface BrowserRow {
  browser: string;
  sessions: number;
  percentage: number;
}

export interface OsRow {
  os: string;
  sessions: number;
  percentage: number;
}

export interface LandingPage {
  path: string;
  sessions: number;
  bounceRate: number;
}

export interface ExitPage {
  path: string;
  exits: number;
}

export async function fetchOverviewKpi(period: Period): Promise<OverviewKpi> {
  const key = `kpi:${period}`;
  const cached = getCached<OverviewKpi>(key);
  if (cached) return cached;
  const fallback: OverviewKpi = {
    sessions: 0,
    sessionsDelta: 0,
    activeUsers: 0,
    activeUsersDelta: 0,
    newUsers: 0,
    newUsersDelta: 0,
    pageViews: 0,
    pageViewsDelta: 0,
    bounceRate: 0,
    bounceRateDelta: 0,
    avgSessionDuration: 0,
    avgSessionDurationDelta: 0,
    engagementRate: 0,
    engagementRateDelta: 0,
    eventsPerSession: 0,
  };
  const result = await safe(async () => {
    const client = getClient();
    const property = getPropertyId();
    const metrics = [
      { name: 'sessions' },
      { name: 'activeUsers' },
      { name: 'newUsers' },
      { name: 'screenPageViews' },
      { name: 'bounceRate' },
      { name: 'averageSessionDuration' },
      { name: 'engagementRate' },
      { name: 'eventCount' },
    ];
    const [curRes, prevRes] = await Promise.all([
      client.runReport({ property, dateRanges: [periodToDates(period)], metrics }),
      client.runReport({ property, dateRanges: [prevPeriodDates(period)], metrics }),
    ]);
    const current = curRes[0]?.rows?.[0]?.metricValues ?? [];
    const previous = prevRes[0]?.rows?.[0]?.metricValues ?? [];
    const sessions = parseNum(current[0]?.value);
    const activeUsers = parseNum(current[1]?.value);
    const newUsers = parseNum(current[2]?.value);
    const pageViews = parseNum(current[3]?.value);
    const bounceRate = parseNum(current[4]?.value);
    const avgSessionDuration = parseNum(current[5]?.value);
    const engagementRate = parseNum(current[6]?.value);
    const events = parseNum(current[7]?.value);
    return {
      sessions,
      sessionsDelta: calcDelta(sessions, parseNum(previous[0]?.value)),
      activeUsers,
      activeUsersDelta: calcDelta(activeUsers, parseNum(previous[1]?.value)),
      newUsers,
      newUsersDelta: calcDelta(newUsers, parseNum(previous[2]?.value)),
      pageViews,
      pageViewsDelta: calcDelta(pageViews, parseNum(previous[3]?.value)),
      bounceRate,
      bounceRateDelta: calcDelta(bounceRate, parseNum(previous[4]?.value)),
      avgSessionDuration,
      avgSessionDurationDelta: calcDelta(avgSessionDuration, parseNum(previous[5]?.value)),
      engagementRate,
      engagementRateDelta: calcDelta(engagementRate, parseNum(previous[6]?.value)),
      eventsPerSession: sessions > 0 ? events / sessions : 0,
    };
  }, 'overview', fallback);
  setCache(key, result, TTL.OVERVIEW);
  return result;
}

export async function fetchTrafficSources(period: Period): Promise<TrafficSource[]> {
  const key = `traffic:${period}`;
  const cached = getCached<TrafficSource[]>(key);
  if (cached) return cached;
  const result = await safe(async () => {
    const client = getClient();
    const property = getPropertyId();
    const [res] = await client.runReport({
      property,
      dateRanges: [periodToDates(period)],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'sessions' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 15,
    });
    const rows = res.rows ?? [];
    const total = rows.reduce((sum, row) => sum + parseNum(row.metricValues?.[0]?.value), 0);
    return rows.map((row) => {
      const sessions = parseNum(row.metricValues?.[0]?.value);
      return {
        channel: row.dimensionValues?.[0]?.value ?? '(none)',
        sessions,
        percentage: total > 0 ? Math.round((sessions / total) * 1000) / 10 : 0,
      };
    });
  }, 'traffic', [] as TrafficSource[]);
  setCache(key, result, TTL.DETAIL);
  return result;
}

export async function fetchDailySeries(period: Period): Promise<DailyPoint[]> {
  const key = `daily:${period}`;
  const cached = getCached<DailyPoint[]>(key);
  if (cached) return cached;
  const result = await safe(async () => {
    const client = getClient();
    const property = getPropertyId();
    const [res] = await client.runReport({
      property,
      dateRanges: [periodToDates(period)],
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'screenPageViews' }, { name: 'sessions' }],
      orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }],
    });
    return (res.rows ?? []).map((row) => {
      const raw = row.dimensionValues?.[0]?.value ?? '';
      return {
        date: raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw,
        views: parseNum(row.metricValues?.[0]?.value),
        sessions: parseNum(row.metricValues?.[1]?.value),
      };
    });
  }, 'daily', [] as DailyPoint[]);
  setCache(key, result, TTL.DETAIL);
  return result;
}

export async function fetchTopPages(period: Period, limit = 20): Promise<TopPage[]> {
  const key = `pages:${period}:${limit}`;
  const cached = getCached<TopPage[]>(key);
  if (cached) return cached;
  const result = await safe(async () => {
    const client = getClient();
    const property = getPropertyId();
    const [res] = await client.runReport({
      property,
      dateRanges: [periodToDates(period)],
      dimensions: [{ name: 'pagePath' }, { name: 'pageTitle' }],
      metrics: [{ name: 'screenPageViews' }, { name: 'averageSessionDuration' }, { name: 'bounceRate' }],
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
      limit,
    });
    return (res.rows ?? []).map((row) => ({
      path: row.dimensionValues?.[0]?.value ?? '/',
      title: row.dimensionValues?.[1]?.value ?? '(no title)',
      views: parseNum(row.metricValues?.[0]?.value),
      avgTimeOnPage: parseNum(row.metricValues?.[1]?.value),
      bounceRate: parseNum(row.metricValues?.[2]?.value),
    }));
  }, 'topPages', [] as TopPage[]);
  setCache(key, result, TTL.DETAIL);
  return result;
}

export async function fetchReferrals(period: Period): Promise<{ sources: ReferralSource[]; searchTerms: SearchTermRow[] }> {
  const key = `referrals:${period}`;
  const cached = getCached<{ sources: ReferralSource[]; searchTerms: SearchTermRow[] }>(key);
  if (cached) return cached;
  const result = await safe(async () => {
    const client = getClient();
    const property = getPropertyId();
    const dates = [periodToDates(period)];
    const [sourceRes, termRes] = await Promise.all([
      client.runReport({
        property,
        dateRanges: dates,
        dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 20,
      }),
      client.runReport({
        property,
        dateRanges: dates,
        dimensions: [{ name: 'searchTerm' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 30,
      }),
    ]);
    const sourceRows = sourceRes[0]?.rows ?? [];
    const total = sourceRows.reduce((sum, row) => sum + parseNum(row.metricValues?.[0]?.value), 0);
    const sources = sourceRows.map((row) => {
      const sessions = parseNum(row.metricValues?.[0]?.value);
      return {
        source: row.dimensionValues?.[0]?.value ?? '(direct)',
        medium: row.dimensionValues?.[1]?.value ?? '(none)',
        sessions,
        percentage: total > 0 ? Math.round((sessions / total) * 1000) / 10 : 0,
      };
    });
    const searchTerms = (termRes[0]?.rows ?? [])
      .map((row) => ({ term: row.dimensionValues?.[0]?.value ?? '', sessions: parseNum(row.metricValues?.[0]?.value) }))
      .filter(({ term }) => {
        const value = term.trim();
        if (!value || value.length < 2 || /^\(/.test(value)) return false;
        if (/^[A-Za-z0-9+/]{20,}={0,2}$/.test(value)) return false;
        if (/^[A-Z][A-Za-z0-9]{15,}/.test(value) && !/[가-힣]/.test(value)) return false;
        return true;
      });
    return { sources, searchTerms };
  }, 'referrals', { sources: [] as ReferralSource[], searchTerms: [] as SearchTermRow[] });
  setCache(key, result, TTL.DETAIL);
  return result;
}

export async function fetchDemographics(period: Period): Promise<{ ages: AgeGroup[]; genders: GenderRow[]; cities: CityRow[]; countries: CountryRow[] }> {
  const key = `demo:${period}`;
  const cached = getCached<{ ages: AgeGroup[]; genders: GenderRow[]; cities: CityRow[]; countries: CountryRow[] }>(key);
  if (cached) return cached;
  const result = await safe(async () => {
    const client = getClient();
    const property = getPropertyId();
    const dates = [periodToDates(period)];
    const [ageGenderRes, cityRes, countryRes] = await Promise.all([
      client.runReport({ property, dateRanges: dates, dimensions: [{ name: 'userAgeBracket' }, { name: 'userGender' }], metrics: [{ name: 'activeUsers' }] }),
      client.runReport({ property, dateRanges: dates, dimensions: [{ name: 'city' }], metrics: [{ name: 'activeUsers' }], orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }], limit: 20 }),
      client.runReport({ property, dateRanges: dates, dimensions: [{ name: 'country' }], metrics: [{ name: 'activeUsers' }], orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }], limit: 15 }),
    ]);
    const ageMap = new Map<string, number>();
    const genderMap = new Map<string, number>();
    let total = 0;
    for (const row of ageGenderRes[0]?.rows ?? []) {
      const age = row.dimensionValues?.[0]?.value ?? 'unknown';
      const gender = (row.dimensionValues?.[1]?.value ?? 'unknown').toLowerCase();
      const users = parseNum(row.metricValues?.[0]?.value);
      total += users;
      ageMap.set(age, (ageMap.get(age) ?? 0) + users);
      genderMap.set(gender, (genderMap.get(gender) ?? 0) + users);
    }
    const mapPercent = (value: number) => (total > 0 ? Math.round((value / total) * 1000) / 10 : 0);
    return {
      ages: Array.from(ageMap.entries()).sort((a, b) => b[1] - a[1]).map(([bracket, users]) => ({ bracket, users, percentage: mapPercent(users) })),
      genders: Array.from(genderMap.entries()).sort((a, b) => b[1] - a[1]).map(([gender, users]) => ({ gender, users, percentage: mapPercent(users) })),
      cities: (cityRes[0]?.rows ?? []).map((row, _, rows) => {
        const users = parseNum(row.metricValues?.[0]?.value);
        const rowTotal = rows.reduce((sum, entry) => sum + parseNum(entry.metricValues?.[0]?.value), 0);
        return { city: row.dimensionValues?.[0]?.value ?? '(not set)', users, percentage: rowTotal > 0 ? Math.round((users / rowTotal) * 1000) / 10 : 0 };
      }),
      countries: (countryRes[0]?.rows ?? []).map((row, _, rows) => {
        const users = parseNum(row.metricValues?.[0]?.value);
        const rowTotal = rows.reduce((sum, entry) => sum + parseNum(entry.metricValues?.[0]?.value), 0);
        return { country: row.dimensionValues?.[0]?.value ?? '(not set)', users, percentage: rowTotal > 0 ? Math.round((users / rowTotal) * 1000) / 10 : 0 };
      }),
    };
  }, 'demographics', { ages: [] as AgeGroup[], genders: [] as GenderRow[], cities: [] as CityRow[], countries: [] as CountryRow[] });
  setCache(key, result, TTL.DETAIL);
  return result;
}

export async function fetchDevices(period: Period): Promise<{ devices: DeviceRow[]; browsers: BrowserRow[]; os: OsRow[] }> {
  const key = `devices:${period}`;
  const cached = getCached<{ devices: DeviceRow[]; browsers: BrowserRow[]; os: OsRow[] }>(key);
  if (cached) return cached;
  const result = await safe(async () => {
    const client = getClient();
    const property = getPropertyId();
    const dates = [periodToDates(period)];
    const [deviceRes, browserRes, osRes] = await Promise.all([
      client.runReport({ property, dateRanges: dates, dimensions: [{ name: 'deviceCategory' }], metrics: [{ name: 'sessions' }] }),
      client.runReport({ property, dateRanges: dates, dimensions: [{ name: 'browser' }], metrics: [{ name: 'sessions' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 10 }),
      client.runReport({ property, dateRanges: dates, dimensions: [{ name: 'operatingSystem' }], metrics: [{ name: 'sessions' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 10 }),
    ]);
    const mapRows = (rows: ReportRow[], keyName: 'device' | 'browser' | 'os') => {
      const total = rows.reduce((sum, row) => sum + parseNum(row.metricValues?.[0]?.value), 0);
      return rows.map((row) => {
        const label = row.dimensionValues?.[0]?.value ?? 'unknown';
        const sessions = parseNum(row.metricValues?.[0]?.value);
        const percentage = total > 0 ? Math.round((sessions / total) * 1000) / 10 : 0;
        if (keyName === 'device') return { device: label, sessions, percentage };
        if (keyName === 'browser') return { browser: label, sessions, percentage };
        return { os: label, sessions, percentage };
      });
    };
    return {
      devices: mapRows(deviceRes[0]?.rows ?? [], 'device') as DeviceRow[],
      browsers: mapRows(browserRes[0]?.rows ?? [], 'browser') as BrowserRow[],
      os: mapRows(osRes[0]?.rows ?? [], 'os') as OsRow[],
    };
  }, 'devices', { devices: [] as DeviceRow[], browsers: [] as BrowserRow[], os: [] as OsRow[] });
  setCache(key, result, TTL.DETAIL);
  return result;
}

export async function fetchEntryExit(period: Period): Promise<{ landings: LandingPage[]; exits: ExitPage[] }> {
  const key = `entryExit:${period}`;
  const cached = getCached<{ landings: LandingPage[]; exits: ExitPage[] }>(key);
  if (cached) return cached;
  const result = await safe(async () => {
    const client = getClient();
    const property = getPropertyId();
    const dates = [periodToDates(period)];
    const [landingRes, exitRes] = await Promise.all([
      client.runReport({ property, dateRanges: dates, dimensions: [{ name: 'landingPage' }], metrics: [{ name: 'sessions' }, { name: 'bounceRate' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 15 }),
      client.runReport({
        property,
        dateRanges: dates,
        dimensions: [{ name: 'pagePath' }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { value: 'session_end' } } },
        orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
        limit: 15,
      }),
    ]);
    return {
      landings: (landingRes[0]?.rows ?? []).map((row) => ({
        path: row.dimensionValues?.[0]?.value ?? '/',
        sessions: parseNum(row.metricValues?.[0]?.value),
        bounceRate: parseNum(row.metricValues?.[1]?.value),
      })),
      exits: (exitRes[0]?.rows ?? []).map((row) => ({
        path: row.dimensionValues?.[0]?.value ?? '/',
        exits: parseNum(row.metricValues?.[0]?.value),
      })),
    };
  }, 'entryExit', { landings: [] as LandingPage[], exits: [] as ExitPage[] });
  setCache(key, result, TTL.DETAIL);
  return result;
}

export async function fetchRealtime(): Promise<{ activeUsers: number; timestamp: string }> {
  const key = 'realtime';
  const cached = getCached<{ activeUsers: number; timestamp: string }>(key);
  if (cached) return cached;
  const result = await safe(async () => {
    const client = getClient();
    const property = getPropertyId();
    const [res] = await client.runRealtimeReport({ property, metrics: [{ name: 'activeUsers' }] });
    return {
      activeUsers: parseNum(res.rows?.[0]?.metricValues?.[0]?.value),
      timestamp: new Date().toISOString(),
    };
  }, 'realtime', { activeUsers: 0, timestamp: new Date().toISOString() });
  setCache(key, result, TTL.REALTIME);
  return result;
}

export { fetchPathMetrics, fetchMultiplePathMetrics, fetchMultiplePathSessionsByNaver } from './path-metrics';
export type { PathMetrics } from './path-metrics';
export { fetchDowChannelPattern, fetchPopularPages } from './popular';
export type { DowChannelRow, PopularPage } from './popular';
export { fetchMonthlyVisitors, fetchMonthlyVisitorsPair } from './monthly';
