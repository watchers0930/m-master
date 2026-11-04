// scripts/naver-blog/api-client.ts — M-Master 블로그 작업자 API 클라이언트 (claim-v1)
//
// 흐름: pending(claim 발급) → verify(게시 직전) → complete | fail
// 모든 요청에 작업자 인증(x-api-key)과 프로토콜 헤더(x-blog-worker-protocol: claim-v1)를 보낸다.
// 쿠키·비밀번호·HTML 원문은 어떤 요청에도 싣지 않는다(fail에는 사유 코드만).
import { API_TIMEOUT_MS } from './config';

export const WORKER_PROTOCOL = 'claim-v1';

export interface WorkerClaim {
  token: string;
  contentVersion: string | null;
  expiresAt: string;
}

export interface PendingItem {
  id: string;
  topic: string;
  textBody: string;
  imageUrl: string | null;
  bodyImageUrls: string[];
  keywords: string[];
  ownerId: string;
  claim: WorkerClaim;
}

export interface PendingResult {
  items: PendingItem[];
  date: string;
  skipped: boolean;
  reason: string | null;
}

export type FailOutcome = 'not_posted' | 'unknown';

/** 서버로 보낼 수 있는 실패 사유 코드. 서버 스키마(schemas/blog-worker.ts)와 같은 형식이어야 한다. */
export type FailReason =
  | 'session_expired' | 'captcha_required' | 'two_factor_required' | 'login_failed' | 'credentials_missing'
  | 'not_publishable' | 'verify_failed' | 'editor_error' | 'publish_url_missing' | 'publish_error'
  | 'timeout' | 'dry_run' | 'worker_crashed';

export class WorkerApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(`작업자 API 실패: ${status} ${code}`);
    this.name = 'WorkerApiError';
  }
  /** 서버가 명확히 거절(4xx)했는지. 5xx·네트워크 오류는 재시도 대상. */
  get definite() { return this.status >= 400 && this.status < 500; }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface WorkerApi {
  pending(): Promise<PendingResult>;
  verify(item: PendingItem): Promise<{ ok: true; expiresAt: string }>;
  complete(item: PendingItem, externalUrl: string): Promise<unknown>;
  fail(item: PendingItem, outcome: FailOutcome, reason: FailReason): Promise<void>;
}

export function createWorkerApi(opts: { appUrl: string; apiKey: string; fetchImpl?: FetchLike; timeoutMs?: number }): WorkerApi {
  const doFetch = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = opts.timeoutMs ?? API_TIMEOUT_MS;
  const headers = (json: boolean): Record<string, string> => ({
    'x-api-key': opts.apiKey,
    'x-blog-worker-protocol': WORKER_PROTOCOL,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  });

  async function call<T>(pathName: string, body?: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(`${opts.appUrl}${pathName}`, {
        method: body ? 'POST' : 'GET',
        headers: headers(Boolean(body)),
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new WorkerApiError(0, 'network_error');
    }
    const data = await res.json().catch(() => null) as { error?: { code?: unknown } } | null;
    if (!res.ok) {
      const code = typeof data?.error?.code === 'string' ? data.error.code : 'unknown_error';
      throw new WorkerApiError(res.status, code);
    }
    return data as T;
  }

  const claimBody = (item: PendingItem) => ({ contentId: item.id, claimToken: item.claim.token });

  return {
    async pending() {
      const data = await call<PendingResult>('/api/blog-publish/pending');
      const items = Array.isArray(data?.items) ? data.items : [];
      // claim이 없는 항목은 claim-v1 계약 위반 → 게시 대상에서 제외(게시 후 기록 불가 상태 방지)
      return { ...data, items: items.filter(i => typeof i?.claim?.token === 'string' && i.claim.token.length >= 32) };
    },
    verify: item => call('/api/blog-publish/verify', claimBody(item)),
    complete: (item, externalUrl) => call('/api/blog-publish/complete', { ...claimBody(item), externalUrl }),
    async fail(item, outcome, reason) {
      await call('/api/blog-publish/fail', { ...claimBody(item), outcome, error: reason });
    },
  };
}

/** 일시 오류(5xx·네트워크)만 재시도. 4xx는 즉시 던진다. */
export async function withRetry<T>(work: () => Promise<T>, attempts = 3, delayMs = 2000): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await work(); }
    catch (error) {
      last = error;
      if (error instanceof WorkerApiError && error.definite) throw error;
      if (i < attempts - 1) await new Promise(r => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw last;
}
