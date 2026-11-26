// 운영 아침 보고서 크론(매일 08:00 KST, 08:30 재시도 — 하루 1통은 lib/ops/report/send.ts가 보장).
// CRON_SECRET만 검사한다. 자동화 스위치·광고 비상 정지와 무관하게 돈다(멈춘 것을 알리는 게 목적이므로).
import type { NextRequest } from "next/server";
import { adsCronRequest } from "@/lib/ads/cron-http";
import { sendDailyReport } from "@/lib/ops/report/send";
export const maxDuration = 120;
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  return adsCronRequest(request, () => sendDailyReport());
}
