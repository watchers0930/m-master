import type { Metadata } from "next";

import { AnalyticsDashboard } from "@/features/analytics/analytics-dashboard";
import { PublicSiteHeader } from "@/features/site/public-site-header";

const metrics = [
  {
    label: "핵심 데이터",
    value: "GA4",
    body: "세션, 활성 사용자, 유입 채널, 랜딩 페이지를 기준으로 콘텐츠 성과를 해석합니다.",
  },
  {
    label: "분석 단위",
    value: "콘텐츠별",
    body: "블로그, 캠페인 랜딩, 채널별 링크 흐름을 한 화면에서 비교할 수 있게 설계합니다.",
  },
  {
    label: "다음 액션",
    value: "재생성",
    body: "반응이 낮은 페이지를 찾은 뒤 콘텐츠 생성 화면으로 돌아가 새 카피와 변형안을 이어서 만듭니다.",
  },
];

const ga4Scopes = [
  "활성 사용자와 세션 추이",
  "소스 / 매체 / 캠페인별 유입",
  "랜딩 페이지별 참여도와 이탈",
  "콘텐츠 발행 후 전환 흐름 확인",
];

export const metadata: Metadata = {
  title: "GA4 Analytics | m-master",
  description: "GA4 기반 방문자 분석 화면",
};

export default function AnalyticsPage() {
  return (
    <main className="analytics-shell">
      <PublicSiteHeader active="analytics" />

      <section className="analytics-hero">
        <div className="analytics-hero-copy">
          <p className="analytics-kicker">GA4 Visitor Analytics</p>
          <h1>콘텐츠 생성 다음 단계는 방문자 흐름을 읽는 일입니다.</h1>
          <p className="analytics-lead">
            방문자 분석은 GA4 기준으로 설계합니다. 어떤 콘텐츠가 유입을 만들었는지, 어느 랜딩 페이지에서
            머물렀는지, 어떤 채널이 실제 반응으로 이어졌는지를 같은 운영 흐름 안에서 확인합니다.
          </p>
          <div className="analytics-actions">
            <a className="showcase-primary-link" href="/studio">
              콘텐츠 생성으로 이동
            </a>
            <a className="showcase-secondary-link" href="/">
              공개 홈 보기
            </a>
          </div>
        </div>

        <div className="analytics-side-panel">
          <div className="analytics-note-card">
            <p>Data Source</p>
            <strong>Google Analytics 4</strong>
            <span>GA4 속성 연결 후 유입, 참여, 랜딩 성과를 기준으로 화면을 확장합니다.</span>
          </div>
        </div>
      </section>

      <section className="analytics-section">
        <div className="analytics-grid">
          {metrics.map((metric) => (
            <article className="analytics-card" key={metric.label}>
              <p>{metric.label}</p>
              <strong>{metric.value}</strong>
              <span>{metric.body}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="analytics-section analytics-detail-section">
        <div className="analytics-detail-card">
          <div className="analytics-detail-head">
            <p className="analytics-kicker">GA4 Scope</p>
            <h2>이 화면에서 확인할 핵심 범위</h2>
          </div>
          <div className="analytics-scope-list">
            {ga4Scopes.map((item, index) => (
              <div className="analytics-scope-item" key={item}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <p>{item}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <AnalyticsDashboard />
    </main>
  );
}
