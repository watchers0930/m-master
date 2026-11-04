// scripts/naver-blog/flow.ts — claim 1건 처리 규칙 (Playwright와 분리된 순수 흐름, 단위 테스트 대상)
//
//   verify(사전) → [게시 단계: 발행 버튼 직전 verify] → complete | fail
//
// 원칙
//  - verify가 거절(409 등)되면 절대 게시하지 않는다(검토 철회·내용 변경·lease 만료).
//  - 최종 "발행" 클릭 전 실패 → fail(not_posted)  : claim 반납, 다음 주기 재대상
//  - 최종 "발행" 클릭 후 실패 → fail(unknown)     : 자동 재게시 금지, 수동 대조
//  - 게시 성공 → complete(재시도, 서버 멱등). 기록 실패 시 URL을 로그로 남겨 수동 대조.
//  - 서버에는 사유 코드만 보낸다(쿠키·비밀번호·HTML 원문 금지).
import { WorkerApiError, withRetry, type WorkerApi, type PendingItem, type FailOutcome, type FailReason } from './api-client';
import type { PublishHooks, PublishOutcome, PublishProgress } from './publish';

export class VerifyRejected extends Error {
  constructor(readonly code: string) { super(`verify 거절: ${code}`); this.name = 'VerifyRejected'; }
}

export type ItemResult =
  | { status: 'published'; url: string }
  | { status: 'dry_run' }
  | { status: 'not_posted'; reason: FailReason }
  | { status: 'unknown'; reason: FailReason; url?: string };

export interface FlowDeps {
  api: WorkerApi;
  dryRun: boolean;
  deadlineMs: number;
  publish: (item: PendingItem, hooks: PublishHooks, progress: PublishProgress) => Promise<PublishOutcome>;
  retryDelayMs?: number;
}

/** 서버 보고는 최선 노력. 보고 실패가 원래 결과를 덮어쓰지 않는다(lease 만료 시 서버가 unknown 처리). */
export async function reportFail(api: WorkerApi, item: PendingItem, outcome: FailOutcome, reason: FailReason, retryDelayMs = 2000) {
  try {
    await withRetry(() => api.fail(item, outcome, reason), 3, retryDelayMs);
    console.log(`[보고] fail(${outcome}, ${reason}) 전송`);
  } catch (error) {
    console.error(`[보고] fail 전송 실패: ${error instanceof WorkerApiError ? `${error.status} ${error.code}` : 'unknown'}`);
  }
}

async function verifyOrThrow(api: WorkerApi, item: PendingItem, retryDelayMs: number) {
  try { await withRetry(() => api.verify(item), 3, retryDelayMs); }
  catch (error) { throw new VerifyRejected(error instanceof WorkerApiError ? error.code : 'unknown_error'); }
}

export async function runClaimedItem(item: PendingItem, deps: FlowDeps): Promise<ItemResult> {
  const delay = deps.retryDelayMs ?? 2000;
  const notPosted = async (reason: FailReason): Promise<ItemResult> => {
    await reportFail(deps.api, item, 'not_posted', reason, delay);
    return { status: 'not_posted', reason };
  };
  const unknown = async (reason: FailReason, url?: string): Promise<ItemResult> => {
    await reportFail(deps.api, item, 'unknown', reason, delay);
    return { status: 'unknown', reason, url };
  };

  // 1) 사전 verify — 본문 타이핑(수 분)에 들어가기 전 빠르게 거절 확인
  try { await verifyOrThrow(deps.api, item, delay); }
  catch (error) {
    console.error(`[verify] 사전 확인 거절(${(error as VerifyRejected).code}) — 게시하지 않음`);
    return notPosted('not_publishable');
  }

  // 2) 게시 — 발행 버튼 직전에 다시 verify, 전체 시간 상한
  const progress: PublishProgress = { publishClicked: false };
  const hooks: PublishHooks = {
    beforePublish: async () => {
      if (progress.cancelled) throw new VerifyRejected('cancelled');
      await verifyOrThrow(deps.api, item, delay);
      console.log('[verify] 게시 직전 확인 통과');
    },
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), deps.deadlineMs); });
  const outcome = await Promise.race([deps.publish(item, hooks, progress), deadline]);
  clearTimeout(timer);

  if (outcome === 'timeout') {
    // 동기적으로 중단 선언 → 이후 최종 클릭은 PublishCancelled로 막힌다.
    progress.cancelled = true;
    console.error(`[시간초과] ${Math.round(deps.deadlineMs / 1000)}초 초과`);
    return progress.publishClicked ? unknown('timeout') : notPosted('timeout');
  }

  if (!outcome.success) {
    if (outcome.cause instanceof VerifyRejected) {
      console.error(`[verify] 게시 직전 거절(${outcome.cause.code}) — 게시하지 않음`);
      return notPosted('not_publishable');
    }
    if (outcome.publishClicked) return unknown(outcome.cause ? 'publish_error' : 'publish_url_missing');
    return notPosted('editor_error');
  }

  // 3) dry-run — 게시하지 않았으므로 claim 반납
  if (deps.dryRun) {
    await reportFail(deps.api, item, 'not_posted', 'dry_run', delay);
    return { status: 'dry_run' };
  }

  // 4) complete — 같은 토큰 재호출은 서버에서 멱등
  try {
    await withRetry(() => deps.api.complete(item, outcome.url), 4, delay);
    return { status: 'published', url: outcome.url };
  } catch (error) {
    const code = error instanceof WorkerApiError ? `${error.status} ${error.code}` : 'unknown';
    console.error(`[complete] 기록 실패(${code}) — 실제 게시됨, 수동 대조 필요: ${outcome.url}`);
    return unknown(error instanceof WorkerApiError && error.status === 400 ? 'publish_url_missing' : 'publish_error', outcome.url);
  }
}
