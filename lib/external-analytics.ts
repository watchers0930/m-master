import type { Ga4OverviewResponse } from "@/lib/ga4";

export interface CustomAnalyticsSourceInput {
  id?: string;
  label: string;
  endpointUrl: string;
  accessKey?: string | null;
}

interface FirstPartyOverviewResponse {
  source: string;
  provider?: "first-party";
  providerLabel?: string;
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

function round(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function slugifyAnalyticsSource(label: string) {
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || `source-${Date.now()}`;
}

export function validateAnalyticsEndpointUrl(input: string) {
  const value = input.trim();
  if (!value) {
    throw new Error("집계 엔드포인트 URL이 필요합니다.");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("올바른 URL 형식이 아닙니다.");
  }

  if (!["https:", "http:"].includes(url.protocol)) {
    throw new Error("http 또는 https URL만 사용할 수 있습니다.");
  }

  return url.toString();
}

export function normalizeCustomSourceInput(input: CustomAnalyticsSourceInput): CustomAnalyticsSourceInput {
  const label = input.label.trim();
  if (!label) {
    throw new Error("프로젝트 이름이 필요합니다.");
  }

  return {
    id: input.id?.trim() || slugifyAnalyticsSource(label),
    label,
    endpointUrl: validateAnalyticsEndpointUrl(input.endpointUrl),
    accessKey: input.accessKey?.trim() || null,
  };
}

export function parseTrackingKey(raw: string, labelFallback: string) {
  const value = raw.trim();
  if (!value) {
    throw new Error("방문자 추적 키를 입력하세요.");
  }

  if (value.startsWith("{")) {
    let parsed: Partial<CustomAnalyticsSourceInput>;
    try {
      parsed = JSON.parse(value) as Partial<CustomAnalyticsSourceInput>;
    } catch {
      throw new Error("JSON 키 형식이 올바르지 않습니다.");
    }
    return normalizeCustomSourceInput({
      label: parsed.label || labelFallback,
      endpointUrl: parsed.endpointUrl || "",
      accessKey: parsed.accessKey || null,
      id: parsed.id,
    });
  }

  if (value.startsWith("http://") || value.startsWith("https://")) {
    const url = new URL(value);
    return normalizeCustomSourceInput({
      label: labelFallback || url.hostname.replace(/^www\./, ""),
      endpointUrl: value,
      accessKey: null,
    });
  }

  const segments = value.split("|").map((item) => item.trim());
  if (segments.length >= 2) {
    return normalizeCustomSourceInput({
      label: segments[0] || labelFallback,
      endpointUrl: segments[1] || "",
      accessKey: segments[2] || null,
    });
  }

  throw new Error("지원하지 않는 키 형식입니다. URL 또는 JSON 키를 입력하세요.");
}

export function adaptFirstPartyOverview(
  source: CustomAnalyticsSourceInput,
  input: FirstPartyOverviewResponse,
): Ga4OverviewResponse {
  const engagedSessions = Math.max(
    0,
    Math.round(input.overview.totalSessions * (1 - input.overview.bounceRate / 100)),
  );

  return {
    source: source.id || slugifyAnalyticsSource(source.label),
    sourceLabel: source.label,
    propertyId: null,
    provider: "first-party",
    providerLabel: input.providerLabel || "자체 수집",
    rangeDays: input.rangeDays,
    generatedAt: input.generatedAt,
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
        ? round((engagedSessions / input.overview.totalSessions) * 100, 1)
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
      `${source.label} 소스는 사용자 추가 수집 엔드포인트를 통해 조회됩니다.`,
    ],
  };
}

export function isGa4OverviewResponse(value: unknown): value is Ga4OverviewResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Ga4OverviewResponse>;
  return typeof candidate.source === "string" &&
    typeof candidate.sourceLabel === "string" &&
    Boolean(candidate.overview) &&
    Array.isArray(candidate.trend) &&
    Array.isArray(candidate.topPages);
}

export function isFirstPartyOverviewResponse(value: unknown): value is FirstPartyOverviewResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<FirstPartyOverviewResponse>;
  return typeof candidate.generatedAt === "string" &&
    Boolean(candidate.overview) &&
    Array.isArray(candidate.trend) &&
    Array.isArray(candidate.topPages);
}
