// 하루 상한 감시 크론(30분). CRON_SECRET만 검사한다 — 파이프라인·광고 비상 정지 스위치와 무관하게 끈다(lib/ads/guard.ts).
import type { NextRequest } from "next/server";
import { adsCronRequest } from "@/lib/ads/cron-http";
import { runGuard } from "@/lib/ads/guard";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  return adsCronRequest(request, () => runGuard(new Date()));
}
