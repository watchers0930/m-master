import { z } from "zod";
import { VendorError } from "./vendor-error";

/**
 * SerpApi REST 클라이언트 — 네이버 AI 브리핑 수집 전용(2026-11-26 대장 승인, DataForSEO 미지원 영역).
 * - 키는 SerpApi 규격상 쿼리스트링(api_key)으로만 전달된다 → 요청 URL을 오류·로그에 절대 싣지 않는다.
 * - 성공한 검색만 월 한도에서 차감되고 실패·오류는 차감되지 않는다(serpapi.com/pricing).
 *   → 일시 장애(네트워크·5xx·처리량 429)는 마감 안에서 최대 2번 더 시도한다(DataForSEO GET 재시도와 같은 기준).
 *   한도 소진·인증 실패·요청 거절은 재시도하지 않는다.
 * - 실패 사유는 DataForSEO와 같은 어휘(VendorError.reason)로 낸다.
 * 2026-11-26 실측: engine=naver(통합검색, ~2.5초) · engine=naver_ai_overview(브리핑 전용, 6~8초).
 */
export class SerpApiError extends VendorError {}

const metadataSchema = z
  .object({ status: z.string().optional() })
  .passthrough();
const responseSchema = z
  .object({
    error: z.string().optional(),
    search_metadata: metadataSchema.optional(),
  })
  .passthrough();
export type SerpApiResponse = z.infer<typeof responseSchema>;

const accountSchema = z
  .object({
    plan_name: z.string().optional(),
    searches_per_month: z.number().optional(),
    plan_searches_left: z.number().optional(),
    this_month_usage: z.number().optional(),
  })
  .passthrough();
export type SerpApiAccount = z.infer<typeof accountSchema>;

const MAX_TIMEOUT_MS = 25000;
const MAX_ATTEMPTS = 3;
const RETRYABLE = new Set(["vendor_unavailable", "vendor_rate_limited", "vendor_http_failed"]);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** 한도 소진은 과금 없는 확정 거절 — DataForSEO 잔액 부족과 같은 사유로 기록한다. */
const QUOTA_EXHAUSTED = /run out of searches|searches? (limit|left)|upgrade your plan/i;
/** 결과 없음은 오류가 아니라 '빈 결과'다(브리핑 미노출로 판정). */
const NO_RESULTS = /(hasn't|has not) returned any results/i;

function errorReason(status: number, message: string | undefined): string {
  if (message && QUOTA_EXHAUSTED.test(message)) return "vendor_payment_required";
  if (status === 401) return "vendor_auth_failed";
  if (status === 429) return "vendor_rate_limited";
  if (status >= 400 && status < 500) return "vendor_request_rejected";
  return "vendor_http_failed";
}

export class SerpApiClient {
  constructor(private transport: typeof fetch = fetch) {}

  private async get(path: "search.json" | "account.json", params: Record<string, string>, deadline: number) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.once(path, params, deadline);
      } catch (error) {
        const wait = 1000 * 2 ** (attempt - 1);
        if (
          !(error instanceof SerpApiError) ||
          !RETRYABLE.has(error.reason) ||
          attempt >= MAX_ATTEMPTS ||
          Date.now() + wait + 1000 >= deadline
        )
          throw error;
        await sleep(wait);
      }
    }
  }

  private async once(path: "search.json" | "account.json", params: Record<string, string>, deadline: number) {
    const key = process.env.SERPAPI_API_KEY?.trim();
    if (!key) throw new SerpApiError("vendor_not_configured");
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new SerpApiError("vendor_unavailable");
    const url = `https://serpapi.com/${path}?${new URLSearchParams({ ...params, api_key: key })}`;
    let response: Response;
    try {
      response = await this.transport(url, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(Math.max(1, Math.min(MAX_TIMEOUT_MS, remaining))),
      });
    } catch {
      throw new SerpApiError("vendor_unavailable");
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new SerpApiError(response.ok ? "vendor_invalid_response" : errorReason(response.status, undefined));
    }
    const message =
      body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : undefined;
    if (!response.ok) throw new SerpApiError(errorReason(response.status, message));
    return { body, message };
  }

  /** 검색 1회(성공 시 월 한도 1 차감). 결과 없음 메시지는 빈 응답으로 돌려준다. */
  async search(engine: "naver" | "naver_ai_overview", query: string, deadline = Date.now() + 45000): Promise<SerpApiResponse> {
    const { body, message } = await this.get("search.json", { engine, query }, deadline);
    if (message) {
      if (NO_RESULTS.test(message)) return {};
      throw new SerpApiError(errorReason(200, message));
    }
    const parsed = responseSchema.safeParse(body);
    if (!parsed.success || parsed.data.search_metadata?.status !== "Success")
      throw new SerpApiError("vendor_invalid_response");
    return parsed.data;
  }

  /** 남은 검색 횟수 조회(무료, 한도 차감 없음). */
  async account(deadline = Date.now() + 15000): Promise<SerpApiAccount> {
    const { body, message } = await this.get("account.json", {}, deadline);
    if (message) throw new SerpApiError(errorReason(200, message));
    const parsed = accountSchema.safeParse(body);
    if (!parsed.success) throw new SerpApiError("vendor_invalid_response");
    return parsed.data;
  }
}
