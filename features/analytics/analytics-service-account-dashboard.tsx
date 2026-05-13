"use client";

import { useEffect, useMemo, useState } from "react";

import type { Ga4OverviewResponse, Ga4ServiceAccountJson } from "@/lib/ga4";

type ApiOk<T> = {
  ok: true;
  data: T;
};

type ApiError = {
  ok: false;
  error: {
    message: string;
  };
};

type ApiResponse<T> = ApiOk<T> | ApiError;

const RANGE_OPTIONS = [
  { value: 7, label: "이번주" },
  { value: 30, label: "이번달" },
  { value: 90, label: "3개월" },
] as const;

const DONUT_COLORS = ["#4f7df2", "#67be84", "#eca61f", "#d64d49", "#7159ea", "#d44d9d", "#18a7b5"];
const PROPERTY_STORAGE_KEY = "m-master:ga4-property-id";

function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function percentage(value: number, total: number): string {
  if (total <= 0) return "0.0%";
  return `${((value / total) * 100).toFixed(1)}%`;
}

function buildDonutGradient(rows: Array<{ count: number }>): string {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  if (total <= 0) {
    return "conic-gradient(#dbe4f0 0 100%)";
  }

  let cursor = 0;
  const stops = rows.slice(0, DONUT_COLORS.length).map((row, index) => {
    const start = cursor;
    cursor += (row.count / total) * 100;
    return `${DONUT_COLORS[index]} ${start}% ${cursor}%`;
  });

  return `conic-gradient(${stops.join(", ")})`;
}

export function AnalyticsServiceAccountDashboard() {
  const [days, setDays] = useState(7);
  const [propertyId, setPropertyId] = useState("");
  const [serviceAccountJsonText, setServiceAccountJsonText] = useState("");
  const [serviceAccountMeta, setServiceAccountMeta] = useState<{
    fileName: string;
    clientEmail: string;
    projectId: string;
  } | null>(null);
  const [data, setData] = useState<Ga4OverviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(PROPERTY_STORAGE_KEY);
    if (saved) {
      setPropertyId(saved);
    }
  }, []);

  useEffect(() => {
    if (propertyId.trim()) {
      window.localStorage.setItem(PROPERTY_STORAGE_KEY, propertyId.trim());
    } else {
      window.localStorage.removeItem(PROPERTY_STORAGE_KEY);
    }
  }, [propertyId]);

  async function loadOverview(selectedDays: number) {
    if (!propertyId.trim()) {
      setError("Property ID를 입력하세요.");
      return;
    }

    if (!serviceAccountJsonText) {
      setError("서비스 계정 JSON 파일을 첨부하세요.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/analytics/overview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          days: selectedDays,
          propertyId: propertyId.trim(),
          serviceAccountJson: serviceAccountJsonText,
        }),
      });

      const payload = (await response.json()) as ApiResponse<Ga4OverviewResponse>;
      if (!payload.ok) {
        throw new Error(payload.error.message);
      }

      setData(payload.data);
      setConnected(true);
    } catch (loadError) {
      setData(null);
      setConnected(false);
      setError(loadError instanceof Error ? loadError.message : "GA4 통계 조회에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!connected || !serviceAccountJsonText || !propertyId.trim()) {
      return;
    }

    void loadOverview(days);
  }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleJsonUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Ga4ServiceAccountJson;
      const clientEmail = parsed.client_email?.trim();
      const projectId = parsed.project_id?.trim();
      const privateKey = parsed.private_key?.trim();

      if ((parsed.type && parsed.type !== "service_account") || !clientEmail || !privateKey) {
        throw new Error("유효한 서비스 계정 JSON 파일이 아닙니다.");
      }

      setServiceAccountJsonText(text);
      setServiceAccountMeta({
        fileName: file.name,
        clientEmail,
        projectId: projectId || "-",
      });
      setConnected(false);
      setError(null);
    } catch (uploadError) {
      setServiceAccountJsonText("");
      setServiceAccountMeta(null);
      setConnected(false);
      setError(uploadError instanceof Error ? uploadError.message : "JSON 파일을 읽지 못했습니다.");
    }
  }

  const channelTotal = data?.topChannels.reduce((sum, row) => sum + row.count, 0) ?? 0;
  const sourceTotal = data?.topSources.reduce((sum, row) => sum + row.sessions, 0) ?? 0;
  const maxViews = Math.max(...(data?.trend.map((item) => item.views) ?? [1]), 1);

  const trafficRows = useMemo(
    () =>
      (data?.topChannels ?? []).slice(0, DONUT_COLORS.length).map((row, index) => ({
        ...row,
        color: DONUT_COLORS[index],
        ratio: percentage(row.count, channelTotal),
      })),
    [channelTotal, data?.topChannels],
  );

  const donutGradient = useMemo(() => buildDonutGradient(trafficRows), [trafficRows]);

  return (
    <main className="analytics-page">
      <section className="analytics-hero-row">
        <div>
          <p className="analytics-breadcrumb">관리자 &gt; 통계 &gt; 방문자 분석</p>
          <h2 className="analytics-page-title">방문자 분석</h2>
        </div>
        <div className="analytics-top-actions">
          <div className="analytics-range-switch">
            {RANGE_OPTIONS.map((option) => (
              <button
                className={days === option.value ? "analytics-range-chip active" : "analytics-range-chip"}
                key={option.value}
                onClick={() => setDays(option.value)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="analytics-live-chip">
            <span className="analytics-live-dot" />
            {connected ? "GA4 연결됨" : "GA4 미연결"}
          </div>
        </div>
      </section>

      {error ? <div className="pipeline-error"><p className="error-text">{error}</p></div> : null}

      <section className="analytics-kpi-grid">
        <article className="analytics-surface analytics-metric-card">
          <p>총 세션</p>
          <strong>{data ? data.overview.sessions.toLocaleString() : "-"}</strong>
          <span>{data ? `최근 ${data.rangeDays}일` : "연결 필요"}</span>
        </article>
        <article className="analytics-surface analytics-metric-card">
          <p>순 방문자</p>
          <strong>{data ? data.overview.totalUsers.toLocaleString() : "-"}</strong>
          <span>{data ? `신규 ${data.overview.newUsers.toLocaleString()}` : "연결 필요"}</span>
        </article>
        <article className="analytics-surface analytics-metric-card">
          <p>이탈률</p>
          <strong>{data ? `${data.overview.bounceRate}%` : "-"}</strong>
          <span>{data ? `참여율 ${data.overview.engagementRate}%` : "연결 필요"}</span>
        </article>
        <article className="analytics-surface analytics-metric-card">
          <p>평균 체류시간</p>
          <strong>{data ? formatDuration(data.overview.avgSessionDurationSec) : "-"}</strong>
          <span>{data ? `페이지뷰 ${data.overview.views.toLocaleString()}` : "연결 필요"}</span>
        </article>
      </section>

      <section className="analytics-two-col-grid">
        <article className="analytics-surface analytics-panel">
          <h3>트래픽 소스</h3>
          <div className="analytics-traffic-layout">
            <div aria-label="트래픽 소스 비율" className="analytics-donut" style={{ background: donutGradient }}>
              <div className="analytics-donut-hole" />
            </div>
            <div className="analytics-legend-list">
              {trafficRows.length === 0 ? <p className="fine-print">GA4 연결 후 채널 비율이 표시됩니다.</p> : null}
              {trafficRows.map((source) => (
                <div className="analytics-legend-row" key={source.label}>
                  <div className="analytics-legend-label">
                    <span className="analytics-legend-dot" style={{ background: source.color }} />
                    {source.label}
                  </div>
                  <strong>{source.ratio}</strong>
                </div>
              ))}
            </div>
          </div>
        </article>

        <article className="analytics-surface analytics-panel">
          <h3>페이지뷰 추이</h3>
          <div className="analytics-line-chart">
            <div className="analytics-line-grid" />
            <div
              className="analytics-chart-bars analytics-chart-bars-dynamic"
              style={{ gridTemplateColumns: `repeat(${Math.max(data?.trend.length || 2, 2)}, minmax(0, 1fr))` }}
            >
              {(data?.trend ?? []).map((item) => (
                <div className="analytics-chart-point" key={item.date}>
                  <span className="analytics-chart-value">{item.views}</span>
                  <div className="analytics-chart-column-wrap">
                    <div className="analytics-chart-column" style={{ height: `${Math.max(14, Math.round((item.views / maxViews) * 160))}px` }} />
                  </div>
                  <span className="analytics-chart-date">{item.date.slice(5)}</span>
                </div>
              ))}
              {!data ? <p className="fine-print analytics-chart-empty">GA4 연결 후 추이가 표시됩니다.</p> : null}
            </div>
          </div>
        </article>
      </section>

      <section className="analytics-two-col-grid">
        <article className="analytics-surface analytics-panel">
          <h3>인기 페이지 TOP 20</h3>
          <div className="analytics-table-wrap">
            <table className="analytics-table">
              <thead>
                <tr>
                  <th>순위</th>
                  <th>페이지 경로</th>
                  <th>제목</th>
                  <th>조회수</th>
                  <th>사용자</th>
                </tr>
              </thead>
              <tbody>
                {(data?.topPages ?? []).map((page, index) => (
                  <tr key={`${page.path}-${index}`}>
                    <td>{index + 1}</td>
                    <td>{page.path}</td>
                    <td>{page.title}</td>
                    <td>{page.views.toLocaleString()}</td>
                    <td>{page.users.toLocaleString()}</td>
                  </tr>
                ))}
                {!data?.topPages.length ? (
                  <tr>
                    <td className="analytics-empty-row" colSpan={5}>GA4 연결 후 상위 페이지가 표시됩니다.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </article>

        <article className="analytics-surface analytics-panel">
          <h3>유입 경로</h3>
          <div className="analytics-source-table">
            <div className="analytics-source-head">
              <span>소스</span>
              <span>매체</span>
              <span>세션수</span>
              <span>비율</span>
            </div>
            {(data?.topSources ?? []).map((item) => (
              <div className="analytics-source-row" key={`${item.source}-${item.medium}`}>
                <span>{item.source}</span>
                <span>{item.medium}</span>
                <span>{item.sessions}</span>
                <div className="analytics-ratio-cell">
                  <div className="analytics-ratio-track">
                    <div className="analytics-ratio-bar" style={{ width: percentage(item.sessions, sourceTotal) }} />
                  </div>
                  <strong>{percentage(item.sessions, sourceTotal)}</strong>
                </div>
              </div>
            ))}
            {!data?.topSources.length ? <p className="fine-print">GA4 연결 후 유입 경로가 표시됩니다.</p> : null}
          </div>
        </article>
      </section>

      <section className="analytics-settings-section">
        <div className="analytics-settings-intro">
          <h2>Google Analytics 연동</h2>
          <p>방문자 분석 대시보드에서 사용할 GA4 서비스 계정 JSON 파일을 첨부합니다.</p>
        </div>

        <article className="analytics-surface analytics-settings-card">
          <div className="analytics-settings-head">
            <div className="analytics-settings-icon">📊</div>
            <div>
              <h3>Google Analytics 4 (GA4)</h3>
              <p>서비스 계정 JSON을 첨부한 뒤 Property ID와 함께 바로 조회합니다.</p>
            </div>
          </div>

          <div className="analytics-connection-banner">
            <span>연결 상태</span>
            <strong className={connected ? "analytics-connected" : "analytics-disconnected"}>
              {connected ? "연결됨" : "미연결"}
            </strong>
          </div>

          <div className="analytics-setting-block">
            <label htmlFor="ga4-property-id">Property ID</label>
            <input
              className="text-input analytics-setting-input"
              id="ga4-property-id"
              onChange={(event) => setPropertyId(event.target.value)}
              placeholder="GA4 속성 ID 숫자"
              value={propertyId}
            />
            <p>GA4 관리 &gt; 속성 &gt; 속성 ID 기준입니다.</p>
          </div>

          <div className="analytics-setting-block">
            <label htmlFor="ga4-service-account-file">서비스 계정 JSON</label>
            <input
              accept="application/json,.json"
              className="analytics-file-input"
              id="ga4-service-account-file"
              onChange={handleJsonUpload}
              type="file"
            />
            {serviceAccountMeta ? (
              <div className="analytics-setting-json">
                <pre>{`{
  "file_name": "${serviceAccountMeta.fileName}",
  "project_id": "${serviceAccountMeta.projectId}",
  "client_email": "${serviceAccountMeta.clientEmail}",
  "private_key": "••••••••"
}`}</pre>
              </div>
            ) : (
              <p>JSON 파일을 첨부하면 서비스 계정 정보 미리보기가 여기에 표시됩니다.</p>
            )}
          </div>

          <div className="analytics-help-box">
            <strong>설정 방법</strong>
            <ol>
              <li>Google Cloud 콘솔에서 서비스 계정을 만들고 JSON 키를 발급합니다.</li>
              <li>GA4 속성 액세스 관리에서 해당 서비스 계정 이메일에 조회 권한을 줍니다.</li>
              <li>이 화면에서 Property ID와 JSON 파일을 첨부합니다.</li>
              <li>업로드된 JSON은 서버에 저장하지 않고 현재 세션 요청에만 사용합니다.</li>
            </ol>
          </div>

          <div className="analytics-settings-actions">
            <button
              className="button ghost"
              onClick={() => {
                setData(null);
                setConnected(false);
                setError(null);
              }}
              type="button"
            >
              초기화
            </button>
            <button
              className="button primary"
              disabled={loading}
              onClick={() => void loadOverview(days)}
              type="button"
            >
              {loading ? "GA4 조회 중…" : "GA4 연결"}
            </button>
          </div>
        </article>
      </section>
    </main>
  );
}
