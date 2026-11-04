// scripts/naver-blog/publish.ts — 글 1건 작성·발행 (Playwright 단계는 원본 publish-naver-blog.ts에서 이동, 동작 동일)
//
// 추가된 것은 claim-v1 연동용 훅 두 개뿐이다.
//   beforePublish   — 발행 버튼을 누르기 직전 서버 verify. 실패하면 던져서 게시하지 않는다.
//   publishClicked  — 최종 "발행" 클릭을 시도했는지. 이후 실패는 "게시됐을 수도 있음(unknown)"으로 보고해야 한다.
import type { Page } from 'playwright';
import { DRY_RUN } from './config';
import { takeScreenshot } from './screenshot';
import { dismissDraftRecoveryPopup, fillTitle, insertVestraFooter, insertTags } from './editor';
import { fillBody } from './editor-body';
import type { PendingItem } from './api-client';

export interface PublishHooks {
  beforePublish: () => Promise<void>;
}

export interface PublishProgress {
  publishClicked: boolean;
  /** 시간 초과 등으로 작업자가 중단을 선언함. 최종 클릭 직전에 확인해 늦은 게시를 막는다. */
  cancelled?: boolean;
}

export class PublishCancelled extends Error {
  constructor() { super('게시 중단됨(시간 초과)'); this.name = 'PublishCancelled'; }
}

export type PublishOutcome =
  | { success: true; url: string }
  | { success: false; error: string; cause: unknown; publishClicked: boolean };

// ---------------------------------------------------------------------------
// 발행 버튼 클릭 + 설정 다이얼로그 처리
// ---------------------------------------------------------------------------
async function clickPublish(page: Page, hooks: PublishHooks, progress: PublishProgress): Promise<string | null> {
  const fl = page.frameLocator('iframe[name="mainFrame"]');

  // 게시 직전 서버 재확인(검토 철회·내용 변경·lease 만료 시 여기서 중단)
  await hooks.beforePublish();

  if (DRY_RUN) {
    console.log('[dry-run] 발행 버튼 클릭 스킵');
    await takeScreenshot(page, 'dry-run-before-publish');
    return null;
  }

  await fl.locator('.publish_btn__m9KHH').click();
  await page.waitForTimeout(2000);
  // 중단 확인과 클릭 표시는 같은 동기 구간에서 처리한다(시간 초과 판정과 경합 없음).
  if (progress.cancelled) throw new PublishCancelled();
  progress.publishClicked = true; // 이 클릭부터는 실제 게시가 일어났을 수 있다
  await fl.locator('button:has-text("발행")').last().click();
  await page.waitForTimeout(5000);

  const currentUrl = page.url();
  if (currentUrl.includes('blog.naver.com') && !currentUrl.includes('Write') && !currentUrl.includes('Redirect')) {
    console.log(`[발행] 성공: ${currentUrl}`);
    return currentUrl;
  }

  await takeScreenshot(page, 'publish-result');
  return null;
}

// ---------------------------------------------------------------------------
// 단일 콘텐츠 발행
// ---------------------------------------------------------------------------
export async function publishOne(
  page: Page,
  item: PendingItem,
  hooks: PublishHooks,
  progress: PublishProgress = { publishClicked: false },
): Promise<PublishOutcome> {
  try {
    await page.goto('https://blog.naver.com/GoBlogWrite.naver', {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    const fl = page.frameLocator('iframe[name="mainFrame"]');
    await fl.locator('.se-title-text').waitFor({ timeout: 10000 });
    await page.waitForTimeout(1000);
    await dismissDraftRecoveryPopup(page);

    await fillTitle(page, item.topic);
    const { tags } = await fillBody(page, item.textBody, item.bodyImageUrls ?? []);
    await insertVestraFooter(page, item.topic);
    await insertTags(page, tags, item.keywords ?? []);
    const url = await clickPublish(page, hooks, progress);

    if (DRY_RUN) return { success: true, url: 'dry-run' };
    if (url) return { success: true, url };
    return { success: false, error: '발행 URL 추출 실패', cause: null, publishClicked: progress.publishClicked };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[발행 실패] ${item.topic}: ${msg}`);
    await takeScreenshot(page, `error-${item.id}`);
    return { success: false, error: msg, cause: err, publishClicked: progress.publishClicked };
  }
}
