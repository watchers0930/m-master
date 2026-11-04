// lib/api/visitors.ts
// 방문자 분석 API 래퍼 (설계 §4.7). 각 섹션은 Ga4Block — 실패를 0·빈 배열로 바꾸지 않는다(§2.4).
import type { Ga4Block } from '@/types/ga4';
import type {
  OverviewKpi, TrafficSource, DailyPoint, TopPage, ReferralSource, SearchTermRow,
  AgeGroup, GenderRow, CityRow, CountryRow, DeviceRow, BrowserRow, OsRow, LandingPage, ExitPage,
} from '@/lib/ga4/visitors';

export type VisitorPeriod = 'today' | 'this_week' | 'this_month' | '7d' | '30d' | '90d' | '365d';

export interface VisitorsData {
  kpi: Ga4Block<OverviewKpi>;
  traffic: Ga4Block<TrafficSource[]>;
  daily: Ga4Block<DailyPoint[]>;
  pages: Ga4Block<TopPage[]>;
  refs: Ga4Block<{ sources: ReferralSource[]; searchTerms: SearchTermRow[] }>;
  demo: Ga4Block<{ ages: AgeGroup[]; genders: GenderRow[]; cities: CityRow[]; countries: CountryRow[] }>;
  devs: Ga4Block<{ devices: DeviceRow[]; browsers: BrowserRow[]; os: OsRow[] }>;
  entry: Ga4Block<{ landings: LandingPage[]; exits: ExitPage[] }>;
  period: string;
}

export interface RealtimeData {
  active_users: number;
  timestamp: string;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, cache: 'no-store' });
  const j = await res.json().catch(() => null) as { data?: T; error?: { message?: string } | string | null } | null;
  if (!res.ok || !j?.data) {
    const msg = typeof j?.error === 'object' ? j?.error?.message : j?.error;
    throw new Error(msg || (res.status === 404 ? '도메인을 찾을 수 없습니다' : `HTTP ${res.status}`));
  }
  return j.data;
}

function qs(params: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : '';
}

export function fetchVisitorsData(period: VisitorPeriod, domainId: string | null, signal?: AbortSignal) {
  return getJson<VisitorsData>(`/api/visitors/data${qs({ period, domain_id: domainId })}`, signal);
}

export function fetchRealtime(domainId: string | null, signal?: AbortSignal) {
  return getJson<Ga4Block<RealtimeData>>(`/api/visitors/realtime${qs({ domain_id: domainId })}`, signal);
}
