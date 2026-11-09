// lib/external/naver-searchad.ts — 네이버 검색광고 API 클라이언트(sync·입찰·예산·감시·통계가 네이버와 말하는 유일한 경로)
// - 서명 = Base64(HMAC-SHA256(secretKey, `${ts}.${METHOD}.${pathWithoutQuery}`)), ts = epoch ms 문자열
// - 변이(POST·PUT)는 1회만 보낸다. 재시도는 GET만(최대 3회, 429는 retry-after ≤5s일 때만 대기)
// - 에러는 고정 사유(reason)·네이버 숫자 code·HTTP status만 담는다. 키·본문·원인(cause)은 절대 싣지 않는다.
// - 키 복호화는 clientForAccount에서만 한다. CredentialCryptoError는 그대로 전파(키·저장 장애를 "네이버 키 오류"로 위장하지 않음).
import { createHmac } from "node:crypto";
import type { AdAccount } from "@prisma/client";
import { z } from "zod";
import { decryptSecret } from "@/lib/crypto/credentials";

const BASE_URL = "https://api.searchad.naver.com";
const DEADLINE_MS = 45000;
const ATTEMPT_TIMEOUT_MS = 25000;
const GET_ATTEMPTS = 3;
const MAX_RETRY_AFTER_MS = 5000;
// 네이버 code: 1016 = 호출 한도 초과, 1018·1006 = 권한 없음(다른 광고주 리소스 등)
const RATE_LIMIT_CODE = 1016;
const FORBIDDEN_CODES = new Set([1018, 1006]);
const SAFE_PATH = /^(?:\/[A-Za-z0-9_-]+)+$/;

export type AdCreds = { customerId: string; apiKey: string; secretKey: string };
export type NaverAdsReason =
  | "ads_auth_failed"
  | "ads_forbidden"
  | "ads_rate_limited"
  | "ads_rejected"
  | "ads_uncertain"
  | "ads_unavailable"
  | "ads_not_connected";
export type NaverAdsQuery = Record<string, string | number | boolean | null | undefined>;

export class NaverAdsError extends Error {
  readonly reason: NaverAdsReason;
  readonly naverCode?: number;
  readonly status?: number;

  constructor(reason: NaverAdsReason, naverCode?: number, status?: number) {
    super(`naver_ads_${reason}`);
    this.name = "NaverAdsError";
    this.reason = reason;
    if (naverCode !== undefined) this.naverCode = naverCode;
    if (status !== undefined) this.status = status;
  }
}

// 저장 AAD context. Task 5(봉인)와 clientForAccount(복호화)가 반드시 같은 함수를 쓴다.
export function adCredentialContext(field: "api_key" | "secret_key", ownerId: string, naverCustomerId: string): string {
  return `ad_accounts.${field}:${ownerId}:${naverCustomerId}`;
}

export function signature(ts: string, method: string, path: string, secret: string): string {
  const bare = path.split("?")[0].split("#")[0];
  return createHmac("sha256", secret).update(`${ts}.${method.toUpperCase()}.${bare}`).digest("base64");
}

// 네이버 에러 본문: { code, title, type, message, status } 일부. 형식이 달라도 분류는 status로 계속한다.
const errorBodySchema = z
  .object({
    code: z.union([z.number(), z.string()]).optional(),
    type: z.string().optional(),
    title: z.string().optional(),
  })
  .passthrough();

type ErrorInfo = { naverCode?: number; invalidSignature: boolean };

function parseErrorBody(text: string): ErrorInfo {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { invalidSignature: false };
  }
  const parsed = errorBodySchema.safeParse(raw);
  if (!parsed.success) return { invalidSignature: false };
  const code = Number(parsed.data.code);
  const label = `${parsed.data.type ?? ""} ${parsed.data.title ?? ""}`;
  return {
    naverCode: parsed.data.code !== undefined && Number.isInteger(code) ? code : undefined,
    invalidSignature: /invalid[-_ ]?signature/i.test(label),
  };
}

function classify(status: number, info: ErrorInfo, mutation: boolean): NaverAdsReason {
  // 5xx가 먼저다: 본문 code(1016·1018 등)가 있어도 변이는 반영 여부를 알 수 없고(uncertain), 조회는 일시 장애다.
  if (status >= 500) return mutation ? "ads_uncertain" : "ads_unavailable";
  if (status === 429 || info.naverCode === RATE_LIMIT_CODE) return "ads_rate_limited";
  if (status === 401) return "ads_auth_failed";
  if (status === 403) return info.invalidSignature ? "ads_auth_failed" : "ads_forbidden";
  if (info.naverCode !== undefined && FORBIDDEN_CODES.has(info.naverCode)) return "ads_forbidden";
  if (status >= 400) return "ads_rejected";
  return mutation ? "ads_uncertain" : "ads_unavailable"; // 1xx·3xx 등 비정상(redirect는 fetch가 이미 거부)
}

function retryAfterMs(header: string | null, attempt: number, now: number): number {
  if (!header) return 1000 * 2 ** attempt;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now;
}

// 시간 의존성(시계·대기·시도별 타임아웃 신호). 기본값은 실제 시간이고, 테스트는 가짜 시계를 주입한다.
export type NaverAdsClock = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  timeout: (ms: number) => AbortSignal;
};
const realClock: NaverAdsClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeout: (ms) => AbortSignal.timeout(ms),
};
// 헤더 값에 제어문자가 섞이면 fetch가 요청 전에 throw → 변이가 "uncertain"으로 오분류된다. 생성 시 거부한다.
const HEADER_SAFE = /^[\x21-\x7e]+$/;

export class NaverAdsClient {
  // #private: JSON.stringify·util.inspect·열거에 키가 드러나지 않는다.
  readonly #creds: AdCreds;
  readonly #transport: typeof fetch;
  readonly #clock: NaverAdsClock;

  constructor(creds: AdCreds, transport: typeof fetch = fetch, clock: NaverAdsClock = realClock) {
    if (!/^\d{1,20}$/.test(creds.customerId) || !HEADER_SAFE.test(creds.apiKey) || !HEADER_SAFE.test(creds.secretKey))
      throw new NaverAdsError("ads_not_connected");
    this.#creds = { ...creds };
    this.#transport = transport;
    this.#clock = clock;
  }

  get<T = unknown>(path: string, query?: NaverAdsQuery): Promise<T> {
    return this.#request<T>("GET", path, undefined, query);
  }

  post<T = unknown>(path: string, body: unknown, query?: NaverAdsQuery): Promise<T> {
    return this.#request<T>("POST", path, body, query);
  }

  put<T = unknown>(path: string, body: unknown, query?: NaverAdsQuery): Promise<T> {
    return this.#request<T>("PUT", path, body, query);
  }

  toJSON(): Record<string, string> {
    return { customerId: this.#creds.customerId };
  }

  async #request<T>(method: "GET" | "POST" | "PUT", path: string, body: unknown, query?: NaverAdsQuery): Promise<T> {
    // 호출자 버그(쿼리를 path에 섞음·외부 호스트·상위 경로)는 네이버 에러가 아니다 — 네트워크 전에 막는다.
    if (!SAFE_PATH.test(path)) throw new Error("naver_ads_invalid_path");
    const mutation = method !== "GET";
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined && value !== null) params.append(key, String(value));
    const url = `${BASE_URL}${path}${params.toString() ? `?${params}` : ""}`;
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const clock = this.#clock;
    const deadline = clock.now() + DEADLINE_MS;
    let last = new NaverAdsError(mutation ? "ads_uncertain" : "ads_unavailable");

    for (let attempt = 0; attempt < (mutation ? 1 : GET_ATTEMPTS); attempt++) {
      if (clock.now() >= deadline) throw last;
      const ts = String(clock.now());
      const headers: Record<string, string> = {
        "X-Timestamp": ts,
        "X-API-KEY": this.#creds.apiKey,
        "X-Customer": this.#creds.customerId,
        "X-Signature": signature(ts, method, path, this.#creds.secretKey),
      };
      if (payload !== undefined) headers["Content-Type"] = "application/json; charset=UTF-8";
      let response: Response;
      let text: string;
      try {
        response = await this.#transport(url, {
          method,
          redirect: "error",
          headers,
          body: payload,
          signal: clock.timeout(Math.max(1, Math.min(ATTEMPT_TIMEOUT_MS, deadline - clock.now()))),
        });
        text = await response.text();
      } catch {
        // 원인(err)은 버린다: 전송 계층 메시지에 URL·헤더가 섞일 수 있다.
        last = new NaverAdsError(mutation ? "ads_uncertain" : "ads_unavailable");
        if (mutation || attempt === GET_ATTEMPTS - 1) throw last;
        await this.#backoff(250 * 2 ** attempt, deadline, last);
        continue;
      }

      if (response.ok) {
        if (text.length === 0) return null as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new NaverAdsError(mutation ? "ads_uncertain" : "ads_unavailable", undefined, response.status);
        }
      }

      const info = parseErrorBody(text);
      const reason = classify(response.status, info, mutation);
      last = new NaverAdsError(reason, info.naverCode, response.status);
      if (mutation || attempt === GET_ATTEMPTS - 1) throw last;
      if (reason === "ads_rate_limited") {
        const wait = retryAfterMs(response.headers.get("retry-after"), attempt, clock.now());
        if (!(wait <= MAX_RETRY_AFTER_MS)) throw last;
        await this.#backoff(Math.max(0, wait), deadline, last);
      } else if (reason === "ads_unavailable") {
        await this.#backoff(250 * 2 ** attempt, deadline, last);
      } else {
        throw last; // 4xx 조회 거부·인증·권한은 재시도해도 같다
      }
    }
    throw last;
  }

  async #backoff(ms: number, deadline: number, error: NaverAdsError): Promise<void> {
    const jittered = ms + Math.random() * 100;
    if (this.#clock.now() + jittered >= deadline) throw error;
    await this.#clock.sleep(jittered);
  }
}

type ConnectableAccount = Pick<AdAccount, "ownerId" | "naverCustomerId" | "apiKeyEnc" | "secretKeyEnc" | "status">;

// 저장된 봉인 blob을 복호화해 클라이언트를 만든다. 비활성·키 없음은 복호화·네트워크 전에 ads_not_connected.
export function clientForAccount(account: ConnectableAccount, transport?: typeof fetch): NaverAdsClient {
  if (account.status !== "active" || account.apiKeyEnc == null || account.secretKeyEnc == null)
    throw new NaverAdsError("ads_not_connected");
  const { ownerId, naverCustomerId } = account;
  return new NaverAdsClient(
    {
      customerId: naverCustomerId,
      apiKey: decryptSecret(account.apiKeyEnc, adCredentialContext("api_key", ownerId, naverCustomerId)),
      secretKey: decryptSecret(account.secretKeyEnc, adCredentialContext("secret_key", ownerId, naverCustomerId)),
    },
    transport,
  );
}
