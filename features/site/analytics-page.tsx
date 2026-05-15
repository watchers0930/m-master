import type { Metadata } from "next";

import { AppHeader } from "@/features/site/app-header";
import { getProjectList } from "@/server/services/project-service";
import { getAnalyticsSnapshot, type AnalyticsRangeKey } from "@/server/services/analytics-service";

export const analyticsMetadata: Metadata = {
  title: "방문자 분석 | m-master",
  description: "M-MASTER 운영용 방문자 분석 화면",
};

const RANGE_OPTIONS: Array<{ key: AnalyticsRangeKey; label: string }> = [
  { key: "today", label: "오늘" },
  { key: "7d", label: "이번주" },
  { key: "30d", label: "이번달" },
  { key: "90d", label: "3개월" },
];

function normalizeRange(value?: string): AnalyticsRangeKey {
  if (value === "today" || value === "7d" || value === "30d" || value === "90d") {
    return value;
  }

  return "7d";
}

type AnalyticsPageProps = {
  searchParams?: {
    range?: string;
    projectId?: string;
  };
};

export async function AnalyticsPage({ searchParams }: AnalyticsPageProps) {
  const projects = await getProjectList();
  const selectedRange = normalizeRange(searchParams?.range);
  const selectedProject = projects.find((project) => project.id === searchParams?.projectId) ?? projects[0] ?? null;
  const snapshot = await getAnalyticsSnapshot(selectedRange, selectedProject?.ga4PropertyId ?? undefined);
  const maxView = Math.max(...snapshot.pageViews.map((item) => item.value), 1);
  const trafficGradientStops = snapshot.trafficSources.length > 0
    ? snapshot.trafficSources
        .reduce<{ start: number; color: string; end: number }[]>((acc, item) => {
          const currentStart = acc.length === 0 ? 0 : acc[acc.length - 1].end;
          const end = currentStart + Number(item.value.replace("%", ""));
          acc.push({ start: currentStart, color: item.color, end });
          return acc;
        }, [])
        .map((item) => `${item.color} ${item.start}% ${Math.min(item.end, 100)}%`)
        .join(", ")
    : "#dbe4f0 0 100%";

  return (
    <div className="app-shell analytics-app-shell">
      <AppHeader active="analytics" title="운영 분석" />

      <main className="analytics-page">
        <section className="analytics-hero-row">
          <div>
            <p className="analytics-breadcrumb">M-MASTER &gt; Studio &gt; Visitor Analytics</p>
            <h2 className="analytics-page-title">방문자 분석</h2>
            <p className="analytics-page-subcopy">콘텐츠 운영 이후 어떤 경로로 유입되고, 어떤 화면에서 머무르는지 같은 제품 안에서 확인합니다.</p>
            {selectedProject ? (
              <p className="analytics-project-context">
                현재 프로젝트: <strong>{selectedProject.name}</strong>
                {selectedProject.ga4PropertyId ? ` · GA4 ${selectedProject.ga4PropertyId}` : " · 프로젝트별 GA4 미설정"}
              </p>
            ) : null}
          </div>
          <div className="analytics-top-actions">
            {projects.length > 0 ? (
              <div className="analytics-project-switch">
                {projects.map((project) => (
                  <a
                    key={project.id}
                    className={selectedProject?.id === project.id ? "analytics-project-chip active" : "analytics-project-chip"}
                    href={`/studio/analytics?projectId=${project.id}&range=${selectedRange}`}
                  >
                    {project.name}
                  </a>
                ))}
              </div>
            ) : null}
            <div className="analytics-range-switch">
              {RANGE_OPTIONS.map((option) => (
                <a
                  key={option.key}
                  className={selectedRange === option.key ? "analytics-range-chip active" : "analytics-range-chip"}
                  href={`/studio/analytics?range=${option.key}${selectedProject ? `&projectId=${selectedProject.id}` : ""}`}
                >
                  {option.label}
                </a>
              ))}
            </div>
            <div className="analytics-live-chip">
              <span className="analytics-live-dot" />
              {snapshot.liveUsers} 명 접속 중
            </div>
          </div>
        </section>

        {snapshot.error ? (
          <section className="analytics-inline-alert">
            <strong>GA4 데이터를 불러오지 못했습니다.</strong>
            <span>{snapshot.error}</span>
          </section>
        ) : null}

        <section className="analytics-kpi-grid">
          {snapshot.metricCards.map((card) => (
            <article className="analytics-surface analytics-metric-card" key={card.label}>
              <p>{card.label}</p>
              <strong>{card.value}</strong>
              <span>{card.delta}</span>
            </article>
          ))}
        </section>

        <section className="analytics-two-col-grid">
          <article className="analytics-surface analytics-panel">
            <h3>트래픽 소스</h3>
            <div className="analytics-traffic-layout">
              <div
                aria-label="트래픽 소스 비율"
                className="analytics-donut"
                style={{
                  background: `conic-gradient(${trafficGradientStops})`,
                }}
              >
                <div className="analytics-donut-hole" />
              </div>
              <div className="analytics-legend-list">
                {snapshot.trafficSources.map((source) => (
                  <div className="analytics-legend-row" key={source.label}>
                    <div className="analytics-legend-label">
                      <span className="analytics-legend-dot" style={{ background: source.color }} />
                      {source.label}
                    </div>
                    <strong>{source.value}</strong>
                  </div>
                ))}
                {snapshot.trafficSources.length === 0 ? <p className="fine-print">표시할 트래픽 소스 데이터가 없습니다.</p> : null}
              </div>
            </div>
          </article>

          <article className="analytics-surface analytics-panel">
            <h3>페이지뷰 추이</h3>
            <div className="analytics-line-chart">
              <div className="analytics-line-grid" />
              <svg className="analytics-line-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                <polyline
                  fill="none"
                  points={snapshot.pageViews.length > 1
                    ? snapshot.pageViews
                        .map((item, index) => {
                          const x = snapshot.pageViews.length === 1 ? 50 : 8 + (84 / (snapshot.pageViews.length - 1)) * index;
                          const y = 82 - ((item.value / maxView) * 64);
                          return `${x},${y}`;
                        })
                        .join(" ")
                    : "8,82 92,18"}
                  stroke="#4f7df2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="3"
                />
              </svg>
              <div className="analytics-chart-bars">
                {snapshot.pageViews.map((item) => (
                  <div className="analytics-chart-point" key={item.date}>
                    <span className="analytics-chart-value">{item.value}</span>
                    <div className="analytics-chart-column-wrap">
                      <div className="analytics-chart-column" style={{ height: `${(item.value / maxView) * 160}px` }} />
                    </div>
                    <span className="analytics-chart-date">{item.date}</span>
                  </div>
                ))}
                {snapshot.pageViews.length === 0 ? <p className="fine-print">표시할 페이지뷰 데이터가 없습니다.</p> : null}
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
                    <th>평균 체류시간</th>
                    <th>이탈률</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.topPages.map((page) => (
                    <tr key={`${page.rank}-${page.path}`}>
                      <td>{page.rank}</td>
                      <td>{page.path}</td>
                      <td>{page.title}</td>
                      <td>{page.views}</td>
                      <td>{page.stay}</td>
                      <td>{page.bounce}</td>
                    </tr>
                  ))}
                  {snapshot.topPages.length === 0 ? (
                    <tr>
                      <td colSpan={6}>표시할 페이지 데이터가 없습니다.</td>
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
              {snapshot.sourcePaths.map((item) => (
                <div className="analytics-source-row" key={`${item.source}-${item.medium}`}>
                  <span>{item.source}</span>
                  <span>{item.medium}</span>
                  <span>{item.sessions}</span>
                  <div className="analytics-ratio-cell">
                    <div className="analytics-ratio-track">
                      <div className="analytics-ratio-bar" style={{ width: item.width }} />
                    </div>
                    <strong>{item.ratio}</strong>
                  </div>
                </div>
              ))}
              {snapshot.sourcePaths.length === 0 ? <p className="fine-print">표시할 유입 경로 데이터가 없습니다.</p> : null}
            </div>
          </article>
        </section>

        <section className="analytics-settings-section">
          <div className="analytics-settings-intro">
            <h2>Google Analytics 연동</h2>
            <p>실데이터 연결 전에도 현재 연결 상태와 필요한 환경변수를 바로 점검할 수 있습니다.</p>
          </div>

          <article className="analytics-surface analytics-settings-card">
            <div className="analytics-settings-head">
              <div className="analytics-settings-icon">GA</div>
              <div>
                <h3>Google Analytics 4 (GA4)</h3>
                <p>운영 화면에서 세션, 페이지, 유입 데이터를 읽기 위한 연결 상태입니다.</p>
              </div>
            </div>

            <div className="analytics-connection-banner">
              <span>연결 상태</span>
              <strong className={snapshot.configured ? "analytics-connected" : "analytics-disconnected"}>
                {snapshot.configured ? "연결됨" : "미연결"}
              </strong>
            </div>

            <div className="analytics-setting-block">
              <label>프로젝트별 속성</label>
              <div className="analytics-setting-value">
                {selectedProject?.ga4PropertyId || "이 프로젝트에는 아직 별도 GA4 속성이 저장되지 않았습니다."}
              </div>
              <p>프로젝트 설정 PATCH에 `ga4PropertyId`를 보내면 프로젝트별 속성을 고정할 수 있습니다.</p>
            </div>

            <div className="analytics-setting-block">
              <label>Property ID</label>
              <div className="analytics-setting-value">{snapshot.propertyId}</div>
              <p>프로젝트별 속성이 있으면 우선 적용하고, 없으면 전역 `GA4_PROPERTY_ID`를 사용합니다.</p>
            </div>

            <div className="analytics-setting-block">
              <label>연결 방식</label>
              <div className="analytics-setting-json">
                <pre>{`{
  "type": "oauth_refresh_token",
  "property_id": "${snapshot.propertyId}",
  "client_id": "${process.env.GA4_OAUTH_CLIENT_ID ? "••••••••" : "미설정"}",
  "refresh_token": "${process.env.GA4_OAUTH_REFRESH_TOKEN ? "••••••••" : "미설정"}",
  "last_loaded_at": "${snapshot.error ? "error" : snapshot.generatedAt}"
}`}</pre>
              </div>
            </div>

            <div className="analytics-help-box">
              <strong>설정 순서</strong>
              <ol>
                <li>Google Cloud에서 OAuth Client를 발급합니다.</li>
                <li>GA4 속성에 접근 가능한 계정으로 refresh token을 발급합니다.</li>
                <li>`GA4_PROPERTY_ID`, `GA4_OAUTH_CLIENT_ID`, `GA4_OAUTH_CLIENT_SECRET`, `GA4_OAUTH_REFRESH_TOKEN`을 설정합니다.</li>
                <li>배포 후 `/studio/analytics`에서 연결 상태와 대시보드를 확인합니다.</li>
              </ol>
            </div>
          </article>
        </section>
      </main>
    </div>
  );
}
