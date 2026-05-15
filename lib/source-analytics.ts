import { fetchGa4Overview, type Ga4OverviewResponse } from "@/lib/ga4";
import { adaptFirstPartyOverview, isFirstPartyOverviewResponse, isGa4OverviewResponse } from "@/lib/external-analytics";

interface VestraPublicOverviewResponse {
  source: "vestra";
  provider: "first-party";
  providerLabel: string;
  rangeDays: number;
  generatedAt: string;
  overview: {
    totalPageViews: number;
    totalSessions: number;
    authenticatedSessions: number;
    anonymousSessions: number;
    knownUsers: number;
    avgPagesPerSession: number;
    avgSessionDurationSec: number;
    avgPageEngagementSec: number;
    bounceRate: number;
  };
  trend: Array<{
    date: string;
    pageViews: number;
    sessions: number;
  }>;
  topPages: Array<{
    path: string;
    pageCategory: string;
    views: number;
    avgEngagementSec: number;
  }>;
  topRegions: Array<{
    label: string;
    count: number;
  }>;
  topCities: Array<{
    label: string;
    count: number;
  }>;
  topReferrers: Array<{
    label: string;
    count: number;
  }>;
  deviceBreakdown: Array<{
    label: string;
    count: number;
  }>;
  browserBreakdown: Array<{
    label: string;
    count: number;
  }>;
  notes: string[];
}

const SOURCE_PUBLIC_OVERVIEW_URLS: Record<string, string | undefined> = {
  vestra: "https://vestra-plum.vercel.app/api/public/analytics/overview",
};

export type AnalyticsSourceConfig =
  | {
      type: "ga4";
      sourceId: string;
      label: string;
    }
  | {
      type: "external";
      sourceId?: string;
      label: string;
      endpointUrl: string;
      accessKey?: string;
    };

function shouldUseFallback(sourceId: string | undefined, overview: Ga4OverviewResponse) {
  return sourceId === "vestra" && overview.overview.sessions === 0 && overview.overview.views === 0;
}

function adaptVestraOverviewToDashboard(input: VestraPublicOverviewResponse): Ga4OverviewResponse {
  const engagedSessions = Math.max(
    0,
    Math.round(input.overview.totalSessions * (1 - input.overview.bounceRate / 100)),
  );

  return {
    source: input.source,
    sourceLabel: "vestra",
    propertyId: null,
    rangeDays: input.rangeDays,
    generatedAt: input.generatedAt,
    provider: "first-party",
    providerLabel: input.providerLabel,
    overview: {
      totalUsers: input.overview.totalSessions,
      newUsers: 0,
      sessions: input.overview.totalSessions,
      engagedSessions,
      views: input.overview.totalPageViews,
      avgSessionDurationSec: input.overview.avgSessionDurationSec,
      bounceRate: input.overview.bounceRate,
      pagesPerSession: input.overview.avgPagesPerSession,
      engagementRate: input.overview.totalSessions > 0
        ? Math.round((engagedSessions / input.overview.totalSessions) * 1000) / 10
        : 0,
    },
    trend: input.trend.map((item) => ({
      date: item.date,
      views: item.pageViews,
      users: item.sessions,
      sessions: item.sessions,
    })),
    topPages: input.topPages.map((item) => ({
      path: item.path,
      title: item.pageCategory || "(제목 없음)",
      views: item.views,
      users: item.views,
    })),
    topChannels: input.topReferrers.map((item) => ({
      label: item.label,
      count: item.count,
    })),
    topRegions: input.topRegions,
    topCities: input.topCities,
    deviceBreakdown: input.deviceBreakdown,
    browserBreakdown: input.browserBreakdown,
    notes: [
      ...input.notes,
      "vestra 소스는 현재 GA4 데이터가 비어 있어 자체 수집 집계로 대체 표시합니다.",
    ],
  };
}

async function fetchFallbackOverview(sourceId: string, rangeDays: number): Promise<Ga4OverviewResponse | null> {
  const url = SOURCE_PUBLIC_OVERVIEW_URLS[sourceId];
  if (!url) return null;

  const response = await fetch(`${url}?days=${rangeDays}`, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`외부 집계 소스 조회 실패 (${response.status}) ${detail.slice(0, 300)}`);
  }

  const json = (await response.json()) as VestraPublicOverviewResponse;
  return adaptVestraOverviewToDashboard(json);
}

export async function fetchSourceOverview(rangeDays: number, sourceId?: string): Promise<Ga4OverviewResponse> {
  const ga4Overview = await fetchGa4Overview(rangeDays, sourceId);

  if (!shouldUseFallback(sourceId, ga4Overview)) {
    return ga4Overview;
  }

  const fallbackOverview = await fetchFallbackOverview(sourceId || "", rangeDays);
  return fallbackOverview || ga4Overview;
}

export async function fetchAnalyticsForSourceConfig(
  rangeDays: number,
  config: AnalyticsSourceConfig,
): Promise<Ga4OverviewResponse> {
  if (config.type === "ga4") {
    return fetchSourceOverview(rangeDays, config.sourceId);
  }

  const response = await fetch(`${config.endpointUrl}?days=${rangeDays}`, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(config.accessKey ? { "x-analytics-key": config.accessKey } : {}),
    },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`외부 집계 소스 조회 실패 (${response.status}) ${detail.slice(0, 300)}`);
  }

  const json = await response.json() as unknown;

  if (isGa4OverviewResponse(json)) {
    return {
      ...json,
      source: config.sourceId || json.source,
      sourceLabel: config.label,
    };
  }

  if (isFirstPartyOverviewResponse(json)) {
    return adaptFirstPartyOverview(
      {
        id: config.sourceId,
        label: config.label,
        endpointUrl: config.endpointUrl,
        accessKey: config.accessKey || null,
      },
      json,
    );
  }

  throw new Error("지원하지 않는 집계 응답 형식입니다.");
}
