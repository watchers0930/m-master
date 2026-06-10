#!/usr/bin/env npx tsx
// scripts/publish-naver-blog.ts — 네이버 블로그 Playwright 자동발행
//
// 실행: npx tsx scripts/publish-naver-blog.ts [--dry-run]
// 환경변수:
//   NAVER_COOKIES        — base64 JSON 쿠키 (GitHub secret)
//   NAVER_ID             — 네이버 아이디 (쿠키 만료 폴백)
//   NAVER_PW             — 네이버 비밀번호
//   BLOG_PUBLISH_API_KEY — M-Master API 인증 키
//   APP_URL              — https://m-master.vercel.app

import { chromium, type Page, type BrowserContext } from 'playwright';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Persistent browser profile (self-hosted runner 전용)
// ---------------------------------------------------------------------------
const USER_DATA_DIR = path.join(os.homedir(), '.naver-blog-browser');

// ---------------------------------------------------------------------------
// 설정
// ---------------------------------------------------------------------------
const APP_URL = process.env.APP_URL ?? 'https://m-master.vercel.app';
const API_KEY = process.env.BLOG_PUBLISH_API_KEY ?? '';
const DRY_RUN = process.argv.includes('--dry-run');
const COOKIES_PATH = path.join(process.cwd(), 'naver-cookies.json');
const SCREENSHOT_DIR = path.join(process.cwd(), 'screenshots');

// ---------------------------------------------------------------------------
// API: 미발행 블로그 콘텐츠 조회
// ---------------------------------------------------------------------------
interface PendingItem {
  id: string;
  topic: string;
  textBody: string;
  imageUrl: string | null;
  bodyImageUrls: string[];
  keywords: string[];
  ownerId: string;
}

async function fetchPendingContent(): Promise<PendingItem[]> {
  const res = await fetch(`${APP_URL}/api/blog-publish/pending`, {
    headers: { 'x-api-key': API_KEY },
  });
  if (!res.ok) throw new Error(`pending API 실패: ${res.status}`);
  const data = await res.json();
  return data.items ?? [];
}

// ---------------------------------------------------------------------------
// API: 발행 완료 보고
// ---------------------------------------------------------------------------
async function reportComplete(contentId: string, externalUrl: string): Promise<void> {
  const res = await fetch(`${APP_URL}/api/blog-publish/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify({ contentId, externalUrl }),
  });
  if (!res.ok) throw new Error(`complete API 실패: ${res.status}`);
}

// ---------------------------------------------------------------------------
// 쿠키 관리
// ---------------------------------------------------------------------------
type CookieParam = Parameters<BrowserContext['addCookies']>[0][number];

function loadCookiesFromEnv(): CookieParam[] | null {
  const b64 = process.env.NAVER_COOKIES;
  if (!b64) return null;
  try {
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
  } catch {
    console.warn('[쿠키] base64 디코딩 실패');
    return null;
  }
}

function loadCookiesFromFile(): CookieParam[] | null {
  if (!fs.existsSync(COOKIES_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function saveCookiesToFile(cookies: unknown[]): void {
  fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
  console.log(`[쿠키] ${COOKIES_PATH} 저장 완료 (${cookies.length}개)`);
}

// ---------------------------------------------------------------------------
// 로그인 상태 확인
// ---------------------------------------------------------------------------
async function checkLoginStatus(page: Page): Promise<boolean> {
  try {
    await page.goto('https://blog.naver.com/GoBlogWrite.naver', {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    // 로그인 안 되어 있으면 로그인 페이지로 리다이렉트됨
    const url = page.url();
    if (url.includes('nidlogin') || url.includes('login')) {
      return false;
    }
    // 에디터 로드 대기 (제목 placeholder)
    const mainFrame = page.frame('mainFrame');
    if (!mainFrame) return false;
    await mainFrame.waitForSelector('.se-title-text', { timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// ID/PW 로그인 (쿠키 만료 시 폴백)
// ---------------------------------------------------------------------------
async function loginToNaver(page: Page): Promise<boolean> {
  const id = process.env.NAVER_ID;
  const pw = process.env.NAVER_PW;
  if (!id || !pw) {
    console.error('[로그인] NAVER_ID/NAVER_PW 환경변수 없음');
    return false;
  }

  console.log('[로그인] ID/PW 로그인 시도...');
  await page.goto('https://nid.naver.com/nidlogin.login', {
    waitUntil: 'domcontentloaded',
  });

  // 네이버 봇 감지 우회: 클립보드 붙여넣기 방식으로 입력
  const idInput = page.locator('#id');
  await idInput.click();
  await page.evaluate((val) => {
    const el = document.querySelector('#id') as HTMLInputElement;
    if (el) { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); }
  }, id);

  await page.waitForTimeout(500);

  const pwInput = page.locator('#pw');
  await pwInput.click();
  await page.evaluate((val) => {
    const el = document.querySelector('#pw') as HTMLInputElement;
    if (el) { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); }
  }, pw);

  await page.waitForTimeout(500);

  // 로그인 버튼 클릭 (패스키 버튼 제외 — type="submit"인 것만)
  await page.locator('button#log\\.login[type="submit"]').click();
  await page.waitForTimeout(3000);

  // 2FA/CAPTCHA 체크
  const url = page.url();
  if (url.includes('nidlogin') || url.includes('captcha') || url.includes('deviceConfirm')) {
    console.error('[로그인] 2FA/CAPTCHA 감지 — 수동 로그인 후 쿠키 갱신 필요');
    await takeScreenshot(page, 'login-blocked');
    return false;
  }

  console.log('[로그인] 성공');
  return true;
}

// ---------------------------------------------------------------------------
// 스크린샷 유틸
// ---------------------------------------------------------------------------
async function takeScreenshot(page: Page, name: string): Promise<void> {
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const filepath = path.join(SCREENSHOT_DIR, `${name}-${Date.now()}.png`);
  await page.screenshot({ path: filepath, fullPage: false });
  console.log(`[스크린샷] ${filepath}`);
}

// ---------------------------------------------------------------------------
// 에디터: 제목 입력 (frameLocator + keyboard.type 방식 — 테스트 검증 완료)
// ---------------------------------------------------------------------------
async function fillTitle(page: Page, title: string): Promise<void> {
  const fl = page.frameLocator('iframe[name="mainFrame"]');
  await fl.locator('.se-section-documentTitle').click();
  await page.waitForTimeout(500);
  await page.keyboard.type(title, { delay: 30 });
  await page.waitForTimeout(300);
  console.log(`[제목] "${title.substring(0, 40)}..." 입력 완료`);
}

// ---------------------------------------------------------------------------
// 이미지 다운로드 (URL → 임시 파일)
// ---------------------------------------------------------------------------
async function downloadImage(url: string, index: number): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[이미지] 다운로드 실패 (${res.status}): ${url}`);
      return null;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const ext = url.match(/\.(jpe?g|png|gif|webp)/i)?.[1] ?? 'jpg';
    const tmpPath = path.join(os.tmpdir(), `blog-img-${index}-${Date.now()}.${ext}`);
    fs.writeFileSync(tmpPath, buffer);
    console.log(`[이미지] 다운로드 완료: ${tmpPath} (${(buffer.length / 1024).toFixed(0)}KB)`);
    return tmpPath;
  } catch (err) {
    console.warn(`[이미지] 다운로드 오류: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// SE 에디터: 이미지 업로드 (사진 버튼 → fileChooser — 테스트 검증 완료)
// ---------------------------------------------------------------------------
async function uploadImage(page: Page, filePath: string): Promise<boolean> {
  const fl = page.frameLocator('iframe[name="mainFrame"]');
  try {
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 10000 }),
      fl.locator('button.se-image-toolbar-button, button[data-name="image"]').first().click(),
    ]);
    await fileChooser.setFiles(filePath);
    await page.waitForTimeout(3000);

    // 라이브러리 패널이 열리면 닫기
    const closeBtn = fl.locator('button:has-text("팝업 닫기")');
    if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await closeBtn.click();
      await page.waitForTimeout(500);
    }

    console.log(`[이미지] 업로드 완료: ${path.basename(filePath)}`);
    return true;
  } catch (err) {
    console.warn(`[이미지] 업로드 실패: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 마크다운 줄 → 플레인텍스트 변환
// ---------------------------------------------------------------------------
function stripMarkdown(line: string): string {
  return line
    .replace(/^#{1,3}\s+/, '')        // 헤딩 마커 제거
    .replace(/\*\*(.+?)\*\*/g, '$1')  // 볼드 제거
    .replace(/\*(.+?)\*/g, '$1')      // 이탤릭 제거
    .replace(/^[-*]\s+/, '• ');       // 리스트 마커 → 불릿
}

// ---------------------------------------------------------------------------
// 에디터: 본문 입력 — 글-이미지 교차 배치 (테스트 검증 완료)
// ---------------------------------------------------------------------------
async function fillBody(
  page: Page,
  text: string,
  bodyImageUrls: string[],
): Promise<void> {
  const fl = page.frameLocator('iframe[name="mainFrame"]');

  // 본문 영역 직접 클릭 (Tab 대신 — Tab은 제목에 본문이 붙는 문제 발생)
  await fl.locator('.se-section-text').click();
  await page.waitForTimeout(500);

  // 텍스트를 [이미지: ...] 마커 기준으로 세그먼트 분리
  const IMAGE_MARKER = /^\[이미지:.*?\]\s*$/;
  const lines = text.split('\n');
  let imageIndex = 0;
  let needsEnterBeforeText = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // 빈 줄 → Enter
    if (!line) {
      await page.keyboard.press('Enter');
      needsEnterBeforeText = false;
      continue;
    }

    // 이미지 마커 → 다운로드 + 업로드
    if (IMAGE_MARKER.test(line)) {
      const imgUrl = bodyImageUrls[imageIndex];
      if (imgUrl) {
        await page.keyboard.press('Enter');
        const tmpPath = await downloadImage(imgUrl, imageIndex);
        if (tmpPath) {
          await uploadImage(page, tmpPath);
          fs.unlinkSync(tmpPath); // 임시 파일 삭제
          needsEnterBeforeText = true;
        }
      }
      imageIndex++;
      continue;
    }

    // 이미지 직후 텍스트 — 이미지 아래 빈 단락을 클릭
    if (needsEnterBeforeText) {
      await fl.locator('.se-section-text').last().click();
      await page.waitForTimeout(300);
      needsEnterBeforeText = false;
    }

    // 텍스트 줄 타이핑
    const plain = stripMarkdown(line);
    if (plain) {
      await page.keyboard.type(plain, { delay: 5 });
    }
    if (i < lines.length - 1) await page.keyboard.press('Enter');
    await page.waitForTimeout(50);
  }

  await page.waitForTimeout(500);
  console.log(`[본문] 타이핑 완료 (이미지 ${imageIndex}개 포함)`);
}

// ---------------------------------------------------------------------------
// 발행 버튼 클릭 + 설정 다이얼로그 처리 (테스트 검증 완료)
// ---------------------------------------------------------------------------
async function clickPublish(page: Page): Promise<string | null> {
  const fl = page.frameLocator('iframe[name="mainFrame"]');

  if (DRY_RUN) {
    console.log('[dry-run] 발행 버튼 클릭 스킵');
    await takeScreenshot(page, 'dry-run-before-publish');
    return null;
  }

  // 1) 상단 발행 버튼 클릭 → 설정 다이얼로그 열림
  await fl.locator('.publish_btn__m9KHH').click();
  await page.waitForTimeout(2000);

  // 2) 다이얼로그 내 최종 "발행" 확인 버튼 (마지막 발행 버튼)
  await fl.locator('button:has-text("발행")').last().click();
  await page.waitForTimeout(5000);

  // 3) 발행 완료 후 URL 추출 — 발행 성공 시 게시글 페이지로 리다이렉트
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
async function publishOne(
  page: Page,
  item: PendingItem,
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    // 새 글쓰기 페이지로 이동
    await page.goto('https://blog.naver.com/GoBlogWrite.naver', {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    // 에디터 로드 대기
    const fl = page.frameLocator('iframe[name="mainFrame"]');
    await fl.locator('.se-title-text').waitFor({ timeout: 10000 });
    await page.waitForTimeout(1000);

    // 제목 입력
    await fillTitle(page, item.topic);

    // 본문 입력 (글-이미지 교차 배치)
    await fillBody(page, item.textBody, item.bodyImageUrls ?? []);

    // 발행
    const url = await clickPublish(page);

    if (DRY_RUN) {
      return { success: true, url: 'dry-run' };
    }

    if (url) {
      return { success: true, url };
    }

    return { success: false, error: '발행 URL 추출 실패' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[발행 실패] ${item.topic}: ${msg}`);
    await takeScreenshot(page, `error-${item.id}`);
    return { success: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// 메인
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log('=== 네이버 블로그 자동발행 시작 ===');
  console.log(`DRY_RUN: ${DRY_RUN}`);
  console.log(`APP_URL: ${APP_URL}`);

  // 1) 미발행 콘텐츠 조회
  const items = await fetchPendingContent();
  if (items.length === 0) {
    console.log('발행할 블로그 콘텐츠 없음. 종료.');
    return;
  }
  console.log(`미발행 콘텐츠 ${items.length}건 조회됨`);

  // 2) 브라우저 시작 — persistent context + anti-detection
  //    self-hosted runner(맥)에서 실행되므로 headed 모드 사용 가능
  //    persistent context는 브라우저 프로필을 유지하여 재로그인 빈도를 줄임
  if (!fs.existsSync(USER_DATA_DIR)) fs.mkdirSync(USER_DATA_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--window-position=0,0',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
    viewport: { width: 1280, height: 900 },
    locale: 'ko-KR',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });

  // navigator.webdriver 숨김
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  // 3) 쿠키 복원 — persistent context에 세션이 없는 경우에만 주입
  const page = context.pages()[0] ?? await context.newPage();

  let loggedIn = await checkLoginStatus(page);
  if (!loggedIn) {
    // persistent context에 세션 없음 → env/file 쿠키 주입 시도
    const cookies = loadCookiesFromEnv() ?? loadCookiesFromFile();
    if (cookies) {
      await context.addCookies(cookies);
      console.log(`[쿠키] ${cookies.length}개 주입됨`);
      loggedIn = await checkLoginStatus(page);
    }
  }

  // 4) 그래도 로그인 안 됨 → ID/PW 폴백
  if (!loggedIn) {
    console.log('[로그인] 쿠키 만료 — ID/PW 로그인 시도');
    loggedIn = await loginToNaver(page);
    if (!loggedIn) {
      console.error('[로그인] 실패. 수동 로그인 후 재시도 필요.');
      await context.close();
      process.exit(1);
    }
  }

  // 5) 콘텐츠별 발행
  let successCount = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    console.log(`\n--- [${i + 1}/${items.length}] ${item.topic} ---`);

    const result = await publishOne(page, item);

    if (result.success && result.url && !DRY_RUN) {
      await reportComplete(item.id, result.url);
      successCount++;
      console.log(`[완료] ${result.url}`);
    } else if (!result.success) {
      console.error(`[실패] ${result.error}`);
    }

    // 연속 발행 시 15초 대기 (스팸 필터 방지)
    if (i < items.length - 1) {
      console.log('[대기] 15초...');
      await page.waitForTimeout(15000);
    }
  }

  // 6) 쿠키 저장 (다음 실행용 — 파일 백업)
  const updatedCookies = await context.cookies();
  saveCookiesToFile(updatedCookies);

  await context.close();

  console.log(`\n=== 완료: ${successCount}/${items.length}건 발행 성공 ===`);
  if (successCount < items.length) process.exit(1);
}

main().catch((err) => {
  console.error('치명적 오류:', err);
  process.exit(1);
});
