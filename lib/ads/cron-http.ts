// lib/ads/cron-http.ts — 광고 크론 3종(감시·심사·성과) 공통 래퍼.
// - CRON_SECRET(verifyCronSecret)만 검사한다. 파이프라인 자동화 스위치(PIPELINE_AUTOMATION_ENABLED)·광고 비상 정지(ADS_EXECUTION_ENABLED)와
//   무관하게 돈다 — 감시(끄기)가 스위치 때문에 멈추면 안 되므로. 쓰기(재개)의 스위치 검사는 execution.ts가 보내기 직전에 한다.
// - 쿼리는 받지 않는다(strict 빈 객체). 응답은 { data: 요약 } + Cache-Control: no-store. 오류는 고정 문구·코드만(키·원문 없음).
import type { NextRequest } from "next/server";
import { z } from "zod";
import { verifyCronSecret } from "@/lib/cron/auth";
import { jsonError, jsonOk, queryParams, VisibilityError } from "@/lib/visibility/http";
import { toAdsHttpError } from "./http";

const noParams = z.object({}).strict();

export async function adsCronRequest(request: NextRequest | Request, work: () => Promise<unknown>): Promise<Response> {
  let response: Response;
  try {
    if (!verifyCronSecret(request as NextRequest)) throw new VisibilityError("unauthorized", "인증이 필요합니다.", 401);
    noParams.parse(queryParams(request));
    response = jsonOk(await work());
  } catch (error) {
    response = jsonError(toAdsHttpError(error));
  }
  response.headers.set("Cache-Control", "no-store");
  return response;
}
