import { logger } from "../logger";

export type AnalyticsRangeKey = "today" | "7d" | "30d" | "90d";

type AnalyticsMetricCard = {
  label: string;
  value: string;
  delta: string;
};

type AnalyticsTrafficSource = {
  label: string;
  value: string;
  color: string;
};

type AnalyticsPageViewPoint = {
  date: string;
  value: number;
};

type AnalyticsTopPage = {
  rank: number;
  path: string;
  title: string;
  views: number;
  stay: string;
  bounce: string;
};

type AnalyticsSourcePath = {
  source: string;
  medium: string;
  sessions: number;
  ratio: string;
  width: string;
};

export type AnalyticsSnapshot = {
  configured: boolean;
  propertyId: string;
  selectedRange: AnalyticsRangeKey;
  generatedAt: string;
  liveUsers: number;
  metricCards: AnalyticsMetricCard[];
  trafficSources: AnalyticsTrafficSource[];
  pageViews: AnalyticsPageViewPoint[];
  topPages: AnalyticsTopPage[];
  sourcePaths: AnalyticsSourcePath[];
  error: string | null;
};

export type AnalyticsHealth = {
  configured: boolean;
  propertyId: string;
  status: "ready" | "warning" | "failed";
  checkedAt: string;
  detail: string;
};

type RangeConfig = {
  startDaysAgo: number;
  endDaysAgo: number;
  label: string;
};

type Ga4ResponseRow = {
  dimensionValues?: Array<{ value?: string }>;
  metricValues?: Array<{ value?: string }>;
};

const RANGE_CONFIG: Record<AnalyticsRangeKey, RangeConfig> = {
  today: { startDaysAgo: 0, endDaysAgo: 0, label: "오늘" },
  "7d": { startDaysAgo: 6, endDaysAgo: 0, label: "최근 7일" },
  "30d": { startDaysAgo: 29, endDaysAgo: 0, label: "최근 30일" },
  "90d": { startDaysAgo: 89, endDaysAgo: 0, label: "최근 90일" },
};

const SOURCE_COLORS = ["#4f7df2", "#67be84", "#eca61f", "#d64d49", "#7159ea", "#d44d9d"];

function getEnv(name: string) {
  return process.env[name]?.trim() || "";
}

function getConfig() {
  const propertyId = getEnv("GA4_PROPERTY_ID");
  const clientId = getEnv("GA4_OAUTH_CLIENT_ID");
  const clientSecret = getEnv("GA4_OAUTH_CLIENT_SECRET");
  const refreshToken = getEnv("GA4_OAUTH_REFRESH_TOKEN");

  return {
    propertyId,
    clientId,
    clientSecret,
    refreshToken,
    configured: Boolean(propertyId && clientId && clientSecret && refreshToken),
  };
}

function resolvePropertyId(config: ReturnType<typeof getConfig>, overridePropertyId?: string) {
  return overridePropertyId?.trim() || config.propertyId;
}

async function getAccessToken(config: ReturnType<typeof getConfig>) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OAuth 토큰 갱신 실패: ${response.status} ${detail}`);
  }

  const payload = await response.json() as { access_token?: string };

  if (!payload.access_token) {
    throw new Error("OAuth 응답에 access_token이 없습니다.");
  }

  return payload.access_token;
}

async function callAnalyticsApi<T>(params: {
  accessToken: string;
  propertyId: string;
  realtime?: boolean;
  body: Record<string, unknown>;
}) {
  const endpoint = params.realtime
    ? `https://analyticsdata.googleapis.com/v1beta/properties/${params.propertyId}:runRealtimeReport`
    : `https://analyticsdata.googleapis.com/v1beta/properties/${params.propertyId}:runReport`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params.body),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GA4 API 호출 실패: ${response.status} ${detail}`);
  }

  return await response.json() as T;
}

function parseMetricValue(row: Ga4ResponseRow | undefined, index: number) {
  return Number(row?.metricValues?.[index]?.value || "0");
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ko-KR").format(Math.round(value));
}

function formatPercentFromRatio(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatDurationSeconds(value: number) {
  const totalSeconds = Math.max(0, Math.round(value));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatCompactDate(value: string) {
  if (!/^\d{8}$/.test(value)) {
    return value;
  }

  return `${value.slice(4, 6)}/${value.slice(6, 8)}`;
}

function splitSourceMedium(value: string) {
  const [source = "(not set)", medium = "(not set)"] = value.split(" / ");
  return { source, medium };
}

function buildEmptySnapshot(
  config: ReturnType<typeof getConfig>,
  selectedRange: AnalyticsRangeKey,
  error: string | null,
  propertyIdOverride?: string,
): AnalyticsSnapshot {
  const label = RANGE_CONFIG[selectedRange].label;
  const propertyId = resolvePropertyId(config, propertyIdOverride);

  return {
    configured: Boolean(propertyId && config.clientId && config.clientSecret && config.refreshToken),
    propertyId: propertyId || "미설정",
    selectedRange,
    generatedAt: new Date().toISOString(),
    liveUsers: 0,
    metricCards: [
      { label: "총 세션", value: "-", delta: `${label} 데이터 대기` },
      { label: "순 방문자", value: "-", delta: `${label} 데이터 대기` },
      { label: "이탈률", value: "-", delta: `${label} 데이터 대기` },
      { label: "평균 체류시간", value: "-", delta: `${label} 데이터 대기` },
    ],
    trafficSources: [],
    pageViews: [],
    topPages: [],
    sourcePaths: [],
    error,
  };
}

export async function getAnalyticsSnapshot(selectedRange: AnalyticsRangeKey, propertyIdOverride?: string): Promise<AnalyticsSnapshot> {
  const config = getConfig();
  const propertyId = resolvePropertyId(config, propertyIdOverride);
  const configured = Boolean(propertyId && config.clientId && config.clientSecret && config.refreshToken);

  if (!configured) {
    return buildEmptySnapshot(config, selectedRange, null, propertyIdOverride);
  }

  const range = RANGE_CONFIG[selectedRange];

  try {
    const accessToken = await getAccessToken(config);

    const [summary, traffic, pageTrend, topPages, sources, realtime] = await Promise.all([
      callAnalyticsApi<{ rows?: Ga4ResponseRow[] }>({
        accessToken,
        propertyId,
        body: {
          dateRanges: [{ startDate: `${range.startDaysAgo}daysAgo`, endDate: `${range.endDaysAgo}daysAgo` }],
          metrics: [
            { name: "sessions" },
            { name: "totalUsers" },
            { name: "bounceRate" },
            { name: "averageSessionDuration" },
          ],
        },
      }),
      callAnalyticsApi<{ rows?: Ga4ResponseRow[] }>({
        accessToken,
        propertyId,
        body: {
          dateRanges: [{ startDate: `${range.startDaysAgo}daysAgo`, endDate: `${range.endDaysAgo}daysAgo` }],
          dimensions: [{ name: "sessionDefaultChannelGroup" }],
          metrics: [{ name: "sessions" }],
          orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
          limit: 6,
        },
      }),
      callAnalyticsApi<{ rows?: Ga4ResponseRow[] }>({
        accessToken,
        propertyId,
        body: {
          dateRanges: [{ startDate: `${range.startDaysAgo}daysAgo`, endDate: `${range.endDaysAgo}daysAgo` }],
          dimensions: [{ name: "date" }],
          metrics: [{ name: "screenPageViews" }],
          orderBys: [{ dimension: { dimensionName: "date" } }],
          limit: selectedRange === "today" ? 1 : 12,
        },
      }),
      callAnalyticsApi<{ rows?: Ga4ResponseRow[] }>({
        accessToken,
        propertyId,
        body: {
          dateRanges: [{ startDate: `${range.startDaysAgo}daysAgo`, endDate: `${range.endDaysAgo}daysAgo` }],
          dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
          metrics: [{ name: "screenPageViews" }, { name: "averageSessionDuration" }, { name: "bounceRate" }],
          orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
          limit: 20,
        },
      }),
      callAnalyticsApi<{ rows?: Ga4ResponseRow[] }>({
        accessToken,
        propertyId,
        body: {
          dateRanges: [{ startDate: `${range.startDaysAgo}daysAgo`, endDate: `${range.endDaysAgo}daysAgo` }],
          dimensions: [{ name: "sessionSourceMedium" }],
          metrics: [{ name: "sessions" }],
          orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
          limit: 8,
        },
      }),
      callAnalyticsApi<{ rows?: Ga4ResponseRow[] }>({
        accessToken,
        propertyId,
        realtime: true,
        body: {
          metrics: [{ name: "activeUsers" }],
          limit: 1,
        },
      }),
    ]);

    const summaryRow = summary.rows?.[0];
    const trafficTotal = (traffic.rows || []).reduce((sum, row) => sum + parseMetricValue(row, 0), 0);
    const sourceTotal = (sources.rows || []).reduce((sum, row) => sum + parseMetricValue(row, 0), 0);

    return {
      configured: true,
      propertyId,
      selectedRange,
      generatedAt: new Date().toISOString(),
      liveUsers: parseMetricValue(realtime.rows?.[0], 0),
      metricCards: [
        { label: "총 세션", value: formatNumber(parseMetricValue(summaryRow, 0)), delta: `${range.label} 기준` },
        { label: "순 방문자", value: formatNumber(parseMetricValue(summaryRow, 1)), delta: `속성 ${propertyId}` },
        { label: "이탈률", value: formatPercentFromRatio(parseMetricValue(summaryRow, 2)), delta: `${range.label} 집계` },
        { label: "평균 체류시간", value: formatDurationSeconds(parseMetricValue(summaryRow, 3)), delta: `${range.label} 평균` },
      ],
      trafficSources: (traffic.rows || []).map((row, index) => ({
        label: row.dimensionValues?.[0]?.value || "(not set)",
        value: trafficTotal > 0 ? formatPercentFromRatio(parseMetricValue(row, 0) / trafficTotal) : "0.0%",
        color: SOURCE_COLORS[index % SOURCE_COLORS.length],
      })),
      pageViews: (pageTrend.rows || []).map((row) => ({
        date: formatCompactDate(row.dimensionValues?.[0]?.value || ""),
        value: parseMetricValue(row, 0),
      })),
      topPages: (topPages.rows || []).map((row, index) => ({
        rank: index + 1,
        path: row.dimensionValues?.[0]?.value || "(not set)",
        title: row.dimensionValues?.[1]?.value || "(제목 없음)",
        views: parseMetricValue(row, 0),
        stay: formatDurationSeconds(parseMetricValue(row, 1)),
        bounce: formatPercentFromRatio(parseMetricValue(row, 2)),
      })),
      sourcePaths: (sources.rows || []).map((row) => {
        const sessions = parseMetricValue(row, 0);
        const ratio = sourceTotal > 0 ? sessions / sourceTotal : 0;
        const { source, medium } = splitSourceMedium(row.dimensionValues?.[0]?.value || "");

        return {
          source,
          medium,
          sessions,
          ratio: formatPercentFromRatio(ratio),
          width: `${Math.max(ratio * 100, ratio > 0 ? 4 : 0)}%`,
        };
      }),
      error: null,
    };
    } catch (error) {
    const message = error instanceof Error ? error.message : "GA4 데이터를 불러오지 못했습니다.";
    logger.error("analytics.snapshot.error", { message, propertyId, selectedRange });
    return buildEmptySnapshot(config, selectedRange, message, propertyIdOverride);
  }
}

export async function getAnalyticsHealth(propertyIdOverride?: string): Promise<AnalyticsHealth> {
  const config = getConfig();
  const propertyId = resolvePropertyId(config, propertyIdOverride);
  const configured = Boolean(propertyId && config.clientId && config.clientSecret && config.refreshToken);

  if (!configured) {
    return {
      configured: false,
      propertyId: propertyId || "미설정",
      status: "failed",
      checkedAt: new Date().toISOString(),
      detail: "GA4 속성 ID 또는 OAuth 환경변수가 완전하지 않습니다.",
    };
  }

  try {
    const accessToken = await getAccessToken(config);
    await callAnalyticsApi<{ rows?: Ga4ResponseRow[] }>({
      accessToken,
      propertyId,
      body: {
        dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
        metrics: [{ name: "sessions" }],
        limit: 1,
      },
    });

    return {
      configured: true,
      propertyId,
      status: "ready",
      checkedAt: new Date().toISOString(),
      detail: "OAuth 토큰 갱신과 GA4 Data API 조회에 성공했습니다.",
    };
  } catch (error) {
    return {
      configured: true,
      propertyId,
      status: "failed",
      checkedAt: new Date().toISOString(),
      detail: error instanceof Error ? error.message : "GA4 연결 점검에 실패했습니다.",
    };
  }
}
