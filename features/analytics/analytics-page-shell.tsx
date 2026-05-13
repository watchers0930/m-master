import { AnalyticsDashboard } from "@/features/analytics/analytics-dashboard";
import { AppHeader } from "@/features/site/app-header";

export function AnalyticsPageShell() {
  return (
    <div className="app-shell analytics-app-shell">
      <AppHeader active="analytics" title="콘텐츠 파이프라인" />
      <AnalyticsDashboard />
    </div>
  );
}
