import { AnalyticsPage, analyticsMetadata } from "@/features/site/analytics-page";

export const metadata = analyticsMetadata;
export const dynamic = "force-dynamic";

export default async function StudioAnalyticsPage(props: {
  searchParams?: Promise<{ range?: string; projectId?: string }>;
}) {
  const searchParams = props.searchParams ? await props.searchParams : undefined;
  return <AnalyticsPage searchParams={searchParams} />;
}
