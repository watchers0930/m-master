#!/usr/bin/env npx tsx
// scripts/naver-blog/main.ts — 네이버 블로그 자동발행 작업자 진입점 (claim-v1)
//
// 실행: npx tsx scripts/naver-blog/main.ts [--dry-run]
// 순서: pending(claim 발급) → 소유자 확인 → 브라우저·세션 확보 → verify → 게시 → complete | fail
// 규칙은 worker-run.ts·flow.ts에 있고, 이 파일은 Playwright 세션 생성과 종료 신호 연결만 맡는다.
// 세션 만료·캡차·2단계 인증은 기다리지 않고 fail(not_posted, 사유코드)로 즉시 보고 후 종료한다.
import * as fs from 'fs';
import { chromium, type Browser, type Page } from 'playwright';
import {
  APP_URL, API_KEY, OWNER_ID, DRY_RUN, STATE_PATH, BROWSER_ARGS, BROWSER_UA,
  ACTION_TIMEOUT_MS, NAVIGATION_TIMEOUT_MS, ITEM_DEADLINE_MS,
} from './config';
import { createWorkerApi, WorkerApiError } from './api-client';
import { ensureLoggedIn } from './login';
import { publishOne } from './publish';
import { pruneScreenshots } from './screenshot';
import { createWorkerRun, exitCodeOf, type WorkerSession } from './worker-run';

const api = createWorkerApi({ appUrl: APP_URL, apiKey: API_KEY, ownerId: OWNER_ID });
let browser: Browser | null = null;

/** storageState 기반 세션 복원 + 로그인 확인. 쿠키 값은 로그·artifact에 남기지 않는다. */
async function openSession(): Promise<WorkerSession<Page>> {
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
  return {
    page,
    login: () => ensureLoggedIn(page, context),
    save: async () => {
      await context.storageState({ path: STATE_PATH });
      if (fs.existsSync(STATE_PATH)) fs.chmodSync(STATE_PATH, 0o600);
    },
  };
}

const worker = createWorkerRun<Page>({
  api, ownerId: OWNER_ID, dryRun: DRY_RUN, deadlineMs: ITEM_DEADLINE_MS, openSession, publishOne,
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    console.error(`[종료] ${signal} 수신 — 진행 중 claim 보고 후 종료`);
    void worker.abort('timeout').finally(() => process.exit(1));
  });
}

async function main(): Promise<number> {
  console.log('=== 네이버 블로그 자동발행 시작 (claim-v1) ===');
  console.log(`DRY_RUN: ${DRY_RUN}`);
  console.log(`APP_URL: ${APP_URL}`);
  if (!API_KEY) { console.error('BLOG_PUBLISH_API_KEY 없음. 종료.'); return 1; }
  // 작업자 1개 = 소유자 1명(네이버 계정 1개). 소유자 미지정이면 서버도 거절하지만 여기서 먼저 멈춘다.
  if (!OWNER_ID) { console.error('BLOG_PUBLISH_OWNER_ID 없음. 종료.'); return 1; }
  pruneScreenshots();
  return exitCodeOf(await worker.run());
}

main()
  .catch(async (err) => {
    console.error('치명적 오류:', err instanceof WorkerApiError ? `${err.status} ${err.code}` : err instanceof Error ? err.message : 'unknown');
    await worker.abort('worker_crashed');
    return 1;
  })
  .then(async (code) => {
    await browser?.close().catch(() => {});
    process.exit(code);
  });
