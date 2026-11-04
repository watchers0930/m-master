#!/usr/bin/env npx tsx
// scripts/naver-blog/main.ts — 네이버 블로그 자동발행 작업자 진입점 (claim-v1)
//
// 실행: npx tsx scripts/naver-blog/main.ts [--dry-run]
// 순서: pending(claim 발급) → 브라우저·세션 확보 → verify → 게시 → complete | fail
// 세션 만료·캡차·2단계 인증은 기다리지 않고 fail(not_posted, 사유코드)로 즉시 보고 후 종료한다.
import * as fs from 'fs';
import { chromium, type Browser } from 'playwright';
import {
  APP_URL, API_KEY, DRY_RUN, STATE_PATH, BROWSER_ARGS, BROWSER_UA,
  ACTION_TIMEOUT_MS, NAVIGATION_TIMEOUT_MS, ITEM_DEADLINE_MS,
} from './config';
import { createWorkerApi, WorkerApiError, type PendingItem } from './api-client';
import { ensureLoggedIn } from './login';
import { publishOne, type PublishProgress } from './publish';
import { reportFail, runClaimedItem } from './flow';
import { pruneScreenshots } from './screenshot';

const api = createWorkerApi({ appUrl: APP_URL, apiKey: API_KEY });

// 종료 신호(workflow timeout·취소) 시 진행 중 claim을 보고하기 위한 상태
let active: { item: PendingItem; progress: PublishProgress } | null = null;
let browser: Browser | null = null;

async function abortActive(reason: 'timeout' | 'worker_crashed') {
  const current = active;
  active = null;
  if (!current) return;
  current.progress.cancelled = true;
  await reportFail(api, current.item, current.progress.publishClicked ? 'unknown' : 'not_posted', reason, 500);
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    console.error(`[종료] ${signal} 수신 — 진행 중 claim 보고 후 종료`);
    void abortActive('timeout').finally(() => process.exit(1));
  });
}

async function main(): Promise<number> {
  console.log('=== 네이버 블로그 자동발행 시작 (claim-v1) ===');
  console.log(`DRY_RUN: ${DRY_RUN}`);
  console.log(`APP_URL: ${APP_URL}`);
  if (!API_KEY) { console.error('BLOG_PUBLISH_API_KEY 없음. 종료.'); return 1; }
  pruneScreenshots();

  // 1) 미발행 콘텐츠 조회 + claim 발급 (서버가 실행당 최대 1건, 소유자별 하루 1건 제한)
  const pending = await api.pending();
  const item = pending.items[0];
  if (!item) {
    console.log(`발행할 블로그 콘텐츠 없음 (reason: ${pending.reason ?? 'none'}). 종료.`);
    return 0;
  }
  const progress: PublishProgress = { publishClicked: false };
  active = { item, progress };
  console.log(`claim 1건 확보: ${item.id} (만료 ${item.claim.expiresAt})`);

  // 2) 브라우저 시작 — storageState 기반 세션 복원
  const hasStateFile = fs.existsSync(STATE_PATH);
  console.log(`[세션] storageState 파일: ${hasStateFile ? STATE_PATH : '없음'}`);
  browser = await chromium.launch({ headless: true, args: BROWSER_ARGS, ignoreDefaultArgs: ['--enable-automation'] });
  const context = await browser.newContext({
    ...(hasStateFile ? { storageState: STATE_PATH } : {}),
    viewport: { width: 1280, height: 900 },
    locale: 'ko-KR',
    userAgent: BROWSER_UA,
  });
  context.setDefaultTimeout(ACTION_TIMEOUT_MS);
  context.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
  // navigator.webdriver 숨김
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  const page = await context.newPage();

  // 3) 로그인 확인 — 실패 사유를 즉시 보고
  const login = await ensureLoggedIn(page, context);
  if (!login.ok) {
    console.error(`[로그인] 실패(${login.reason}). naver-login-setup.ts 재실행 필요.`);
    active = null;
    await reportFail(api, item, 'not_posted', login.reason);
    return 1;
  }

  // 4) 게시 (claim 1건)
  console.log(`\n--- ${item.topic} ---`);
  const result = await runClaimedItem(item, {
    api, dryRun: DRY_RUN, deadlineMs: ITEM_DEADLINE_MS,
    publish: (target, hooks) => publishOne(page, target, hooks, progress),
  });
  active = null;

  // 5) 세션 갱신 저장 (쿠키 값은 로그·artifact에 남기지 않는다)
  await context.storageState({ path: STATE_PATH }).catch(() => console.warn('[세션] storageState 저장 실패'));
  if (fs.existsSync(STATE_PATH)) fs.chmodSync(STATE_PATH, 0o600);

  switch (result.status) {
    case 'published': console.log(`\n=== 완료: 1건 발행 성공 ${result.url} ===`); return 0;
    case 'dry_run': console.log('\n=== dry-run 완료 (claim 반납) ==='); return 0;
    case 'not_posted':
      console.error(`\n=== 게시 안 함 (${result.reason}) ===`);
      return result.reason === 'not_publishable' ? 0 : 1;
    case 'unknown': console.error(`\n=== 결과 불명 (${result.reason}) — 수동 대조 필요 ===`); return 1;
  }
}

main()
  .catch(async (err) => {
    console.error('치명적 오류:', err instanceof WorkerApiError ? `${err.status} ${err.code}` : err instanceof Error ? err.message : 'unknown');
    await abortActive('worker_crashed');
    return 1;
  })
  .then(async (code) => {
    await browser?.close().catch(() => {});
    process.exit(code);
  });
