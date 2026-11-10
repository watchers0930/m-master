// 광고 성과 수집 크론(매일 KST 06:00, 최근 7일 재수집 — lib/ads/sync-stats.ts).
import type { NextRequest } from "next/server";
import { adsCronRequest } from "@/lib/ads/cron-http";
import { syncStats } from "@/lib/ads/sync-stats";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  return adsCronRequest(request, () => syncStats(7, new Date()));
}
