import type { Metadata } from "next";

import { AppHeader } from "@/features/site/app-header";

const metricCards = [
  { label: "총 세션", value: "48", delta: "▲ 100.0%" },
  { label: "순 방문자", value: "38", delta: "▲ 100.0%" },
  { label: "이탈률", value: "87.5%", delta: "▲ 100.0%" },
  { label: "평균 체류시간", value: "6:18", delta: "▲ 100.0%" },
];

const trafficSources = [
  { label: "Direct", value: "40.0%", color: "#4f7df2" },
  { label: "Organic Search", value: "29.0%", color: "#67be84" },
  { label: "Unassigned", value: "22.0%", color: "#eca61f" },
  { label: "Referral", value: "5.0%", color: "#d64d49" },
  { label: "Organic Social", value: "2.0%", color: "#7159ea" },
  { label: "Paid Search", value: "2.0%", color: "#d44d9d" },
];

const pageViews = [
  { date: "05/12", value: 22 },
  { date: "05/13", value: 122 },
];

const topPages = [
  { rank: 1, path: "/", title: "등기온 - 법인등기 부동산등기 서비스", views: 77, stay: "4:31", bounce: "90.3%" },
  { rank: 2, path: "/pricing", title: "요금 안내", views: 18, stay: "2:14", bounce: "54.2%" },
  { rank: 3, path: "/blog/content-checklist", title: "5월 콘텐츠 운영 체크리스트", views: 13, stay: "3:06", bounce: "42.1%" },
];

const sourcePaths = [
  { source: "(direct)", medium: "(none)", sessions: 23, ratio: "40.0%", width: "40%" },
  { source: "(not set)", medium: "(not set)", sessions: 13, ratio: "22.0%", width: "22%" },
  { source: "google", medium: "organic", sessions: 11, ratio: "19.0%", width: "19%" },
  { source: "naver", medium: "organic", sessions: 8, ratio: "14.0%", width: "14%" },
];

export const metadata: Metadata = {
  title: "방문자 분석 | m-master",
  description: "콘텐츠 성과와 유입 흐름을 확인하는 방문자 분석 화면",
};

export default function AnalyticsPage() {
  const propertyId = process.env.GA4_PROPERTY_ID?.trim() || "미설정";
  const isConfigured = Boolean(
    process.env.GA4_PROPERTY_ID?.trim() &&
      process.env.GA4_OAUTH_CLIENT_ID?.trim() &&
      process.env.GA4_OAUTH_CLIENT_SECRET?.trim() &&
      process.env.GA4_OAUTH_REFRESH_TOKEN?.trim(),
  );

  const maxView = Math.max(...pageViews.map((item) => item.value), 1);

  return (
    <div className="app-shell analytics-app-shell">
      <AppHeader active="analytics" title="콘텐츠 파이프라인" />

      <main className="analytics-page">
        <section className="analytics-hero-row">
          <div>
            <p className="analytics-breadcrumb">관리자 &gt; 통계 &gt; 방문자 분석</p>
            <h2 className="analytics-page-title">방문자 분석</h2>
          </div>
          <div className="analytics-top-actions">
            <div className="analytics-range-switch">
              <button className="analytics-range-chip" type="button">오늘</button>
              <button className="analytics-range-chip active" type="button">이번주</button>
              <button className="analytics-range-chip" type="button">이번달</button>
              <button className="analytics-range-chip" type="button">3개월</button>
            </div>
            <div className="analytics-live-chip">
              <span className="analytics-live-dot" />
              0 명 접속 중
            </div>
          </div>
        </section>

        <section className="analytics-kpi-grid">
          {metricCards.map((card) => (
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
                  background:
                    "conic-gradient(#4f7df2 0 40%, #67be84 40% 69%, #eca61f 69% 91%, #d64d49 91% 96%, #7159ea 96% 98%, #d44d9d 98% 100%)",
                }}
              >
                <div className="analytics-donut-hole" />
              </div>
              <div className="analytics-legend-list">
                {trafficSources.map((source) => (
                  <div className="analytics-legend-row" key={source.label}>
                    <div className="analytics-legend-label">
                      <span className="analytics-legend-dot" style={{ background: source.color }} />
                      {source.label}
                    </div>
                    <strong>{source.value}</strong>
                  </div>
                ))}
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
                  points="8,82 92,18"
                  stroke="#4f7df2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="3"
                />
              </svg>
              <div className="analytics-chart-bars">
                {pageViews.map((item) => (
                  <div className="analytics-chart-point" key={item.date}>
                    <span className="analytics-chart-value">{item.value}</span>
                    <div className="analytics-chart-column-wrap">
                      <div className="analytics-chart-column" style={{ height: `${(item.value / maxView) * 160}px` }} />
                    </div>
                    <span className="analytics-chart-date">{item.date}</span>
                  </div>
                ))}
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
                  {topPages.map((page) => (
                    <tr key={`${page.rank}-${page.path}`}>
                      <td>{page.rank}</td>
                      <td>{page.path}</td>
                      <td>{page.title}</td>
                      <td>{page.views}</td>
                      <td>{page.stay}</td>
                      <td>{page.bounce}</td>
                    </tr>
                  ))}
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
              {sourcePaths.map((item) => (
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
            </div>
          </article>
        </section>

        <section className="analytics-settings-section">
          <div className="analytics-settings-intro">
            <h2>Google Analytics 연동</h2>
            <p>방문자 분석 대시보드에서 사용할 GA4 연결 상태를 확인합니다.</p>
          </div>

          <article className="analytics-surface analytics-settings-card">
            <div className="analytics-settings-head">
              <div className="analytics-settings-icon">📊</div>
              <div>
                <h3>Google Analytics 4 (GA4)</h3>
                <p>방문자 분석 데이터를 가져오기 위한 연결 상태를 표시합니다.</p>
              </div>
            </div>

            <div className="analytics-connection-banner">
              <span>연결 상태</span>
              <strong className={isConfigured ? "analytics-connected" : "analytics-disconnected"}>
                {isConfigured ? "연결됨" : "미연결"}
              </strong>
            </div>

            <div className="analytics-setting-block">
              <label>Property ID</label>
              <div className="analytics-setting-value">{propertyId}</div>
              <p>GA4 관리 &gt; 속성 &gt; 속성 ID 기준</p>
            </div>

            <div className="analytics-setting-block">
              <label>연결 방식</label>
              <div className="analytics-setting-json">
                <pre>{`{
  "type": "oauth_refresh_token",
  "property_id": "${propertyId}",
  "client_id": "${process.env.GA4_OAUTH_CLIENT_ID ? "••••••••" : "미설정"}",
  "refresh_token": "${process.env.GA4_OAUTH_REFRESH_TOKEN ? "••••••••" : "미설정"}"
}`}</pre>
              </div>
            </div>

            <div className="analytics-help-box">
              <strong>설정 방법</strong>
              <ol>
                <li>Google Cloud에서 OAuth Client를 발급합니다.</li>
                <li>GA4 속성에 연결된 계정으로 refresh token을 발급합니다.</li>
                <li>`GA4_PROPERTY_ID`, `GA4_OAUTH_CLIENT_ID`, `GA4_OAUTH_CLIENT_SECRET`, `GA4_OAUTH_REFRESH_TOKEN`을 설정합니다.</li>
                <li>배포 후 `/analytics`에서 대시보드를 확인합니다.</li>
              </ol>
            </div>
          </article>
        </section>
      </main>
    </div>
  );
}
