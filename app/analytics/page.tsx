import type { Metadata } from "next";

import { AnalyticsServiceAccountDashboard } from "@/features/analytics/analytics-service-account-dashboard";
import { AppHeader } from "@/features/site/app-header";

export const metadata: Metadata = {
  title: "방문자 분석 | m-master",
  description: "콘텐츠 성과와 유입 흐름을 확인하는 방문자 분석 화면",
};

export default function AnalyticsPage() {
  return (
    <div className="app-shell analytics-app-shell">
      <AppHeader active="analytics" title="콘텐츠 파이프라인" />
      <AnalyticsServiceAccountDashboard />
    </div>
  );
}
