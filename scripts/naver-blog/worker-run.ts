// scripts/naver-blog/worker-run.ts — 작업자 1회 실행 오케스트레이션 (Playwright와 분리, 단위 테스트 대상)
//
// 순서: pending(claim 발급) → 소유자 확인 → 세션 확보·로그인 → claim 실행 → 세션 저장
// main.ts는 브라우저 세션 생성과 종료 신호 연결만 맡고, 규칙은 모두 여기서 처리한다.
//
// 원칙
//  - 진행 상태(progress)는 flow.createClaimRun이 만든 단 하나의 객체를 게시 함수·abort가 함께 쓴다.
//    (별도 객체를 넘기면 시간초과 판정이 실제 클릭을 못 보고 not_posted로 반납 → 다음 실행에서 중복 게시)
//  - 작업자 1개 배포 = 소유자 1명(네이버 세션 1개). 다른 소유자의 claim은 게시하지 않는다.
import type { WorkerApi, PendingItem } from './api-client';
import type { LoginResult } from './login';
import type { PublishHooks, PublishOutcome, PublishProgress } from './publish';
import { createClaimRun, reportFail, type ClaimRun, type ItemResult } from './flow';

export interface WorkerSession<P> {
  page: P;
  login: () => Promise<LoginResult>;
  /** 세션 갱신 저장(쿠키 값은 로그에 남기지 않는다). 실패해도 결과를 바꾸지 않는다. */
  save: () => Promise<void>;
}

export interface WorkerRunDeps<P> {
  api: WorkerApi;
  /** 이 배포가 게시할 수 있는 유일한 소유자(env BLOG_PUBLISH_OWNER_ID) */
  ownerId: string;
  dryRun: boolean;
  deadlineMs: number;
  retryDelayMs?: number;
  openSession: () => Promise<WorkerSession<P>>;
  publishOne: (page: P, item: PendingItem, hooks: PublishHooks, progress: PublishProgress) => Promise<PublishOutcome>;
}

export type WorkerRunResult =
  | { status: 'idle'; reason: string | null }
  | { status: 'owner_mismatch' }
  | { status: 'login_failed'; reason: string }
  | ItemResult;

export function createWorkerRun<P>(deps: WorkerRunDeps<P>) {
  let active: ClaimRun | null = null;
  const delay = deps.retryDelayMs ?? 2000;

  /** 종료 신호(workflow timeout·취소)·치명 오류 시 진행 중 claim 보고. 같은 progress를 취소 표시해 늦은 클릭도 막는다. */
  async function abort(reason: 'timeout' | 'worker_crashed') {
    const current = active;
    active = null;
    if (!current) return;
    current.progress.cancelled = true;
    await reportFail(deps.api, current.item, current.progress.publishClicked ? 'unknown' : 'not_posted', reason, delay);
  }

  async function run(): Promise<WorkerRunResult> {
    const pending = await deps.api.pending();
    const item = pending.items[0];
    if (!item) return { status: 'idle', reason: pending.reason ?? null };

    // 서버가 다른 소유자의 claim을 돌려주면(설정 오류·서버 결함) 이 계정으로 게시하지 않는다.
    if (item.ownerId !== deps.ownerId) {
      console.error('[소유자] 설정된 소유자와 claim 소유자가 다름 — 게시하지 않음');
      await reportFail(deps.api, item, 'not_posted', 'owner_mismatch', delay);
      return { status: 'owner_mismatch' };
    }

    let session: WorkerSession<P> | null = null;
    const claim = createClaimRun(item, {
      api: deps.api, dryRun: deps.dryRun, deadlineMs: deps.deadlineMs, retryDelayMs: deps.retryDelayMs,
      // flow가 넘겨주는 progress를 그대로 게시 함수에 전달한다(별도 객체 금지).
      publish: (target, hooks, progress) => deps.publishOne(session!.page, target, hooks, progress),
    });
    active = claim;
    console.log(`claim 1건 확보: ${item.id} (만료 ${item.claim.expiresAt})`);

    session = await deps.openSession();
    const login = await session.login();
    if (!login.ok) {
      console.error(`[로그인] 실패(${login.reason}). naver-login-setup.ts 재실행 필요.`);
      active = null;
      await reportFail(deps.api, item, 'not_posted', login.reason, delay);
      return { status: 'login_failed', reason: login.reason };
    }

    console.log(`\n--- ${item.topic} ---`);
    const result = await claim.run();
    active = null;
    await session.save().catch(() => console.warn('[세션] storageState 저장 실패'));
    return result;
  }

  return { run, abort };
}

/** 실행 결과 → 프로세스 종료 코드 */
export function exitCodeOf(result: WorkerRunResult): number {
  switch (result.status) {
    case 'idle': console.log(`발행할 블로그 콘텐츠 없음 (reason: ${result.reason ?? 'none'}). 종료.`); return 0;
    case 'owner_mismatch': return 1;
    case 'login_failed': return 1;
    case 'published': console.log(`\n=== 완료: 1건 발행 성공 ${result.url} ===`); return 0;
    case 'dry_run': console.log('\n=== dry-run 완료 (claim 반납) ==='); return 0;
    case 'not_posted':
      console.error(`\n=== 게시 안 함 (${result.reason}) ===`);
      return result.reason === 'not_publishable' ? 0 : 1;
    case 'unknown': console.error(`\n=== 결과 불명 (${result.reason}) — 수동 대조 필요 ===`); return 1;
  }
}
