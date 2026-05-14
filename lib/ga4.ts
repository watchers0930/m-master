export interface Ga4OverviewResponse {
  source: string;
  sourceLabel: string;
  propertyId: string | null;
  provider?: "ga4" | "first-party";
  providerLabel?: string;
  rangeDays: number;
  generatedAt: string;
  overview: {
    totalUsers: number;
    newUsers: number;
    sessions: number;
    engagedSessions: number;
    views: number;
    avgSessionDurationSec: number;
    bounceRate: number;
    pagesPerSession: number;
    engagementRate: number;
  };
  trend: Array<{
    date: string;
    views: number;
    users: number;
    sessions: number;
  }>;
  topPages: Array<{
    path: string;
    title: string;
    views: number;
    users: number;
  }>;
  topChannels: Array<{
    label: string;
    count: number;
  }>;
  topRegions: Array<{
    label: string;
    count: number;
  }>;
  topCities: Array<{
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

export interface Ga4SourceHealth {
  source: string;
  sourceLabel: string;
  propertyId: string | null;
  configured: boolean;
  status: "healthy" | "no-data" | "error" | "not-configured";
  rangeDays: number;
  checkedAt: string;
  issues: string[];
  overview?: {
    totalUsers: number;
    sessions: number;
    views: number;
  };
}

export interface Ga4HealthResponse {
  generatedAt: string;
  rangeDays: number;
  sources: Ga4SourceHealth[];
  globalIssue?: string;
}

interface Ga4MetricValue {
  value: string;
}

interface Ga4DimensionValue {
  value: string;
}

interface Ga4ReportRow {
  dimensionValues?: Ga4DimensionValue[];
  metricValues?: Ga4MetricValue[];
}

interface Ga4RunReportResponse {
  rows?: Ga4ReportRow[];
}

interface Ga4OAuthConfig {
  source: string;
  sourceLabel: string;
  propertyId: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

interface Ga4SourceOption {
  id: string;
  label: string;
}

const GA4_SOURCE_OPTIONS: Array<{ id: string; label: string; envPrefix: string }> = [
  { id: "m-master", label: "m-master", envPrefix: "GA4_SOURCE_M_MASTER" },
  { id: "vestra", label: "vestra", envPrefix: "GA4_SOURCE_VESTRA" },
];

const GA4_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GA4_DATA_API_BASE = "https://analyticsdata.googleapis.com/v1beta";

function readSourceConfig(source: { id: string; label: string; envPrefix: string }): Ga4OAuthConfig | null {
  const propertyId = process.env[`${source.envPrefix}_PROPERTY_ID`]?.trim();
  const clientId = process.env[`${source.envPrefix}_OAUTH_CLIENT_ID`]?.trim();
  const clientSecret = process.env[`${source.envPrefix}_OAUTH_CLIENT_SECRET`]?.trim();
  const refreshToken = process.env[`${source.envPrefix}_OAUTH_REFRESH_TOKEN`]?.trim();

  if (!propertyId || !clientId || !clientSecret || !refreshToken) {
    return null;
  }

  return {
    source: source.id,
    sourceLabel: source.label,
    propertyId,
    clientId,
    clientSecret,
    refreshToken,
  };
}

function readLegacyConfig(): Ga4OAuthConfig | null {
  const propertyId = process.env.GA4_PROPERTY_ID?.trim();
  const clientId = process.env.GA4_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GA4_OAUTH_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GA4_OAUTH_REFRESH_TOKEN?.trim();

  if (!propertyId || !clientId || !clientSecret || !refreshToken) {
    return null;
  }

  return {
    source: "m-master",
    sourceLabel: "m-master",
    propertyId,
    clientId,
    clientSecret,
    refreshToken,
  };
}

function getDefaultGa4SourceId() {
  const requested = process.env.GA4_DEFAULT_SOURCE?.trim();
  if (requested && GA4_SOURCE_OPTIONS.some((source) => source.id === requested)) {
    return requested;
  }
  return "m-master";
}

function getGa4Config(sourceId?: string): Ga4OAuthConfig {
  const multiSourceConfigs = GA4_SOURCE_OPTIONS.map(readSourceConfig).filter((value): value is Ga4OAuthConfig => Boolean(value));
  const defaultSourceId = sourceId || getDefaultGa4SourceId();

  if (multiSourceConfigs.length > 0) {
    const selected = multiSourceConfigs.find((config) => config.source === defaultSourceId);
    if (!selected) {
      throw new Error(`GA4 source '${defaultSourceId}' 가 설정되지 않았습니다.`);
    }
    return selected;
  }

  const legacyConfig = readLegacyConfig();
  if (legacyConfig) {
    if (defaultSourceId !== "m-master") {
      throw new Error(`GA4 source '${defaultSourceId}' 가 설정되지 않았습니다.`);
    }
    return legacyConfig;
  }

  throw new Error(
    "GA4 OAuth 환경변수(GA4_PROPERTY_ID, GA4_OAUTH_CLIENT_ID, GA4_OAUTH_CLIENT_SECRET, GA4_OAUTH_REFRESH_TOKEN 또는 GA4_SOURCE_* 세트)가 설정되지 않았습니다.",
  );
}

function getGa4ConfigMap() {
  const multiSourceConfigs = GA4_SOURCE_OPTIONS.map(readSourceConfig).filter((value): value is Ga4OAuthConfig => Boolean(value));

  if (multiSourceConfigs.length > 0) {
    return new Map(multiSourceConfigs.map((config) => [config.source, config]));
  }

  const legacyConfig = readLegacyConfig();
  return new Map(legacyConfig ? [[legacyConfig.source, legacyConfig]] : []);
}
async function getGa4AccessToken(config: Ga4OAuthConfig): Promise<string> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetch(GA4_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`GA4 OAuth 토큰 갱신 실패 (${response.status}) ${detail.slice(0, 300)}`);
  }

  const json = (await response.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new Error("GA4 OAuth 응답에 access_token이 없습니다.");
  }

  return json.access_token;
}

async function runReport(
  accessToken: string,
  propertyId: string,
  body: Record<string, unknown>,
): Promise<Ga4RunReportResponse> {
  const response = await fetch(`${GA4_DATA_API_BASE}/properties/${propertyId}:runReport`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`GA4 Data API 조회 실패 (${response.status}) ${detail.slice(0, 300)}`);
  }

  return (await response.json()) as Ga4RunReportResponse;
}

function metricNumber(row: Ga4ReportRow | undefined, index: number): number {
  const raw = row?.metricValues?.[index]?.value;
  if (!raw) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dimensionText(row: Ga4ReportRow | undefined, index: number): string {
  return row?.dimensionValues?.[index]?.value?.trim() || "";
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatDate(yyyymmdd: string): string {
  if (!/^\d{8}$/.test(yyyymmdd)) return yyyymmdd;
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

function buildDateRange(rangeDays: number) {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - Math.max(0, rangeDays - 1));

  const toIsoDate = (value: Date) => value.toISOString().slice(0, 10);
  return { startDate: toIsoDate(startDate), endDate: toIsoDate(endDate) };
}

export function listGa4Sources(): Ga4SourceOption[] {
  const multiSourceConfigs = GA4_SOURCE_OPTIONS.map(readSourceConfig).filter((value): value is Ga4OAuthConfig => Boolean(value));
  if (multiSourceConfigs.length > 0) {
    return multiSourceConfigs.map((config) => ({ id: config.source, label: config.sourceLabel }));
  }

  return readLegacyConfig() ? [{ id: "m-master", label: "m-master" }] : [];
}

function buildHealthIssues(overview: Ga4OverviewResponse) {
  const issues: string[] = [];

  if (overview.overview.sessions === 0 && overview.overview.views === 0) {
    issues.push("최근 조회 구간에 세션과 페이지뷰가 없습니다. 태그 차단, 속성 불일치, 미수집 상태를 확인해야 합니다.");
  }

  if (overview.topPages.length === 0) {
    issues.push("상위 페이지 데이터가 비어 있습니다. page_view 수집 여부를 함께 확인하세요.");
  }

  return issues;
}

export async function fetchGa4Health(rangeDays = 7): Promise<Ga4HealthResponse> {
  const configMap = getGa4ConfigMap();
  const sources = await Promise.all(
    GA4_SOURCE_OPTIONS.map(async (sourceOption) => {
      const config = configMap.get(sourceOption.id) || null;

      if (!config) {
        return {
          source: sourceOption.id,
          sourceLabel: sourceOption.label,
          propertyId: null,
          configured: false,
          status: "not-configured" as const,
          rangeDays,
          checkedAt: new Date().toISOString(),
          issues: ["이 소스의 GA4 OAuth 환경변수가 설정되지 않았습니다."],
        };
      }

      try {
        const overview = await fetchGa4Overview(rangeDays, sourceOption.id);
        const issues = buildHealthIssues(overview);

        return {
          source: sourceOption.id,
          sourceLabel: sourceOption.label,
          propertyId: overview.propertyId,
          configured: true,
          status: issues.length > 0 ? ("no-data" as const) : ("healthy" as const),
          rangeDays,
          checkedAt: new Date().toISOString(),
          issues,
          overview: {
            totalUsers: overview.overview.totalUsers,
            sessions: overview.overview.sessions,
            views: overview.overview.views,
          },
        };
      } catch (error) {
        return {
          source: sourceOption.id,
          sourceLabel: sourceOption.label,
          propertyId: config.propertyId,
          configured: true,
          status: "error" as const,
          rangeDays,
          checkedAt: new Date().toISOString(),
          issues: [error instanceof Error ? error.message : "GA4 헬스체크 중 오류가 발생했습니다."],
        };
      }
    }),
  );

  return {
    generatedAt: new Date().toISOString(),
    rangeDays,
    sources,
  };
}

export function isGa4Configured(sourceId?: string): boolean {
  if (sourceId) {
    try {
      getGa4Config(sourceId);
      return true;
    } catch {
      return false;
    }
  }

  return listGa4Sources().length > 0;
}

export async function fetchGa4Overview(rangeDays: number, sourceId?: string): Promise<Ga4OverviewResponse> {
  const config = getGa4Config(sourceId);
  const accessToken = await getGa4AccessToken(config);
  const dateRange = buildDateRange(rangeDays);

  const [summaryReport, trendReport, pagesReport, channelsReport, regionsReport, citiesReport, devicesReport, browsersReport] =
    await Promise.all([
      runReport(accessToken, config.propertyId, {
        dateRanges: [dateRange],
        metrics: [
          { name: "totalUsers" },
          { name: "newUsers" },
          { name: "sessions" },
          { name: "engagedSessions" },
          { name: "screenPageViews" },
          { name: "averageSessionDuration" },
          { name: "bounceRate" },
        ],
      }),
      runReport(accessToken, config.propertyId, {
        dateRanges: [dateRange],
        dimensions: [{ name: "date" }],
        metrics: [{ name: "screenPageViews" }, { name: "totalUsers" }, { name: "sessions" }],
        orderBys: [{ dimension: { dimensionName: "date" } }],
        limit: 400,
      }),
      runReport(accessToken, config.propertyId, {
        dateRanges: [dateRange],
        dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
        metrics: [{ name: "screenPageViews" }, { name: "totalUsers" }],
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
        limit: 12,
      }),
      runReport(accessToken, config.propertyId, {
        dateRanges: [dateRange],
        dimensions: [{ name: "sessionDefaultChannelGroup" }],
        metrics: [{ name: "sessions" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 10,
      }),
      runReport(accessToken, config.propertyId, {
        dateRanges: [dateRange],
        dimensions: [{ name: "country" }, { name: "region" }],
        metrics: [{ name: "sessions" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 10,
      }),
      runReport(accessToken, config.propertyId, {
        dateRanges: [dateRange],
        dimensions: [{ name: "region" }, { name: "city" }],
        metrics: [{ name: "sessions" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 10,
      }),
      runReport(accessToken, config.propertyId, {
        dateRanges: [dateRange],
        dimensions: [{ name: "deviceCategory" }],
        metrics: [{ name: "sessions" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 10,
      }),
      runReport(accessToken, config.propertyId, {
        dateRanges: [dateRange],
        dimensions: [{ name: "browser" }],
        metrics: [{ name: "sessions" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 10,
      }),
    ]);

  const summaryRow = summaryReport.rows?.[0];
  const totalUsers = metricNumber(summaryRow, 0);
  const newUsers = metricNumber(summaryRow, 1);
  const sessions = metricNumber(summaryRow, 2);
  const engagedSessions = metricNumber(summaryRow, 3);
  const views = metricNumber(summaryRow, 4);
  const avgSessionDurationSec = metricNumber(summaryRow, 5);
  const bounceRate = metricNumber(summaryRow, 6) * 100;

  return {
    source: config.source,
    sourceLabel: config.sourceLabel,
    propertyId: config.propertyId,
    provider: "ga4",
    providerLabel: "GA4",
    rangeDays,
    generatedAt: new Date().toISOString(),
    overview: {
      totalUsers,
      newUsers,
      sessions,
      engagedSessions,
      views,
      avgSessionDurationSec: round(avgSessionDurationSec, 1),
      bounceRate: round(bounceRate, 1),
      pagesPerSession: round(sessions > 0 ? views / sessions : 0, 2),
      engagementRate: round(sessions > 0 ? (engagedSessions / sessions) * 100 : 0, 1),
    },
    trend: (trendReport.rows || []).map((row) => ({
      date: formatDate(dimensionText(row, 0)),
      views: metricNumber(row, 0),
      users: metricNumber(row, 1),
      sessions: metricNumber(row, 2),
    })),
    topPages: (pagesReport.rows || []).map((row) => ({
      path: dimensionText(row, 0) || "/",
      title: dimensionText(row, 1) || "(제목 없음)",
      views: metricNumber(row, 0),
      users: metricNumber(row, 1),
    })),
    topChannels: (channelsReport.rows || []).map((row) => ({
      label: dimensionText(row, 0) || "Unassigned",
      count: metricNumber(row, 0),
    })),
    topRegions: (regionsReport.rows || []).map((row) => ({
      label: [dimensionText(row, 0), dimensionText(row, 1)].filter(Boolean).join(" / ") || "미상",
      count: metricNumber(row, 0),
    })),
    topCities: (citiesReport.rows || []).map((row) => ({
      label: [dimensionText(row, 0), dimensionText(row, 1)].filter(Boolean).join(" / ") || "미상",
      count: metricNumber(row, 0),
    })),
    deviceBreakdown: (devicesReport.rows || []).map((row) => ({
      label: dimensionText(row, 0) || "unknown",
      count: metricNumber(row, 0),
    })),
    browserBreakdown: (browsersReport.rows || []).map((row) => ({
      label: dimensionText(row, 0) || "Unknown",
      count: metricNumber(row, 0),
    })),
    notes: [
      "이 화면은 Google Analytics 4 Data API 집계값을 OAuth 사용자 토큰으로 조회합니다.",
      "GA4 권한, OAuth 동의, refresh token 상태가 잘못되면 API에서 오류가 반환됩니다.",
    ],
  };
}
