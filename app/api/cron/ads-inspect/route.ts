// 광고 심사 상태 동기화 크론(30분, lib/ads/sync-inspect.ts).
import type { NextRequest } from "next/server";
import { adsCronRequest } from "@/lib/ads/cron-http";
import { syncInspect } from "@/lib/ads/sync-inspect";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  return adsCronRequest(request, () => syncInspect(new Date()));
}
