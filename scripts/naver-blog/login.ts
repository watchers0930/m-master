// scripts/naver-blog/login.ts — 네이버 세션 확인·복구 (storageState → env 쿠키 → ID/PW)
//
// 로그인 불가 상태(세션 만료·캡차·2단계 인증)는 기다리지 않고 즉시 사유 코드로 돌려준다.
// 쿠키·비밀번호 값은 로그·서버 보고 어디에도 남기지 않는다.
import type { Page, BrowserContext } from 'playwright';
import { takeScreenshot } from './screenshot';
import type { FailReason } from './api-client';

export type LoginResult = { ok: true } | { ok: false; reason: Extract<FailReason,
  'session_expired' | 'captcha_required' | 'two_factor_required' | 'login_failed' | 'credentials_missing'> };

// ---------------------------------------------------------------------------
// 쿠키 관리
// ---------------------------------------------------------------------------
type CookieParam = Parameters<BrowserContext['addCookies']>[0][number];

export function loadCookiesFromEnv(): CookieParam[] | null {
  const b64 = process.env.NAVER_COOKIES;
  if (!b64) return null;
  try {
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
  } catch {
    console.warn('[쿠키] base64 디코딩 실패');
    return null;
  }
}

// ---------------------------------------------------------------------------
// 로그인 상태 확인
// ---------------------------------------------------------------------------
export async function checkLoginStatus(page: Page): Promise<boolean> {
  try {
    // 네이버 세션 쿠키 존재 확인
    const cookies = await page.context().cookies();
    const hasSession = cookies.some((c) => c.name === 'NID_AUT' || c.name === 'NID_SES');
    if (!hasSession) {
      console.log('[로그인] 세션 쿠키 없음');
      return false;
    }
    console.log(`[로그인] 세션 쿠키 발견 (전체 ${cookies.length}개)`);

    // 실제 블로그 글쓰기 접근 테스트
    await page.goto('https://blog.naver.com/GoBlogWrite.naver', {
      waitUntil: 'load',
      timeout: 20000,
    });

    // 리다이렉트 안정화 대기
    await page.waitForTimeout(2000);
    let url = page.url();

    if (url.includes('nidlogin')) return false;

    // Redirect=Write 패턴 → 재이동
    if (url.includes('Redirect=Write')) {
      await page.waitForTimeout(3000);
      await page.goto('https://blog.naver.com/GoBlogWrite.naver', {
        waitUntil: 'load',
        timeout: 20000,
      });
      await page.waitForTimeout(2000);
      url = page.url();
      if (url.includes('nidlogin')) return false;
    }

    // 에디터 프레임 로드 확인
    const mainFrame = page.frame('mainFrame');
    if (!mainFrame) {
      console.log(`[로그인] mainFrame 없음 (URL: ${url})`);
      return false;
    }
    await mainFrame.waitForSelector('.se-title-text', { timeout: 15000 });
    console.log('[로그인] 블로그 에디터 접근 확인 완료');
    return true;
  } catch (err) {
    console.log(`[로그인] 체크 실패: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 로그인 차단 화면 판별 (캡차·2단계 인증·로그인 실패)
// ---------------------------------------------------------------------------
const CAPTCHA_SELECTOR = '#captcha, #captchaimg, #rcapt, .captcha_wrap, input[name="chptcha"]';

export function classifyLoginUrl(url: string): LoginResult {
  const lower = url.toLowerCase();
  if (lower.includes('captcha')) return { ok: false, reason: 'captcha_required' };
  if (['deviceconfirm', '2step', 'otp', '/login/ext/', 'newdevice'].some(k => lower.includes(k)))
    return { ok: false, reason: 'two_factor_required' };
  if (lower.includes('nidlogin')) return { ok: false, reason: 'login_failed' };
  return { ok: true };
}

async function detectLoginBlock(page: Page): Promise<LoginResult> {
  const captchaVisible = await page.locator(CAPTCHA_SELECTOR).first().isVisible({ timeout: 1000 }).catch(() => false);
  if (captchaVisible) return { ok: false, reason: 'captcha_required' };
  return classifyLoginUrl(page.url());
}

// ---------------------------------------------------------------------------
// ID/PW 로그인 (쿠키 만료 시 폴백)
// ---------------------------------------------------------------------------
async function loginToNaver(page: Page): Promise<LoginResult> {
  const id = process.env.NAVER_ID;
  const pw = process.env.NAVER_PW;
  if (!id || !pw) {
    console.error('[로그인] NAVER_ID/NAVER_PW 환경변수 없음');
    return { ok: false, reason: 'credentials_missing' };
  }

  console.log('[로그인] ID/PW 로그인 시도...');
  await page.goto('https://nid.naver.com/nidlogin.login', {
    waitUntil: 'domcontentloaded',
  });

  // 로그인 화면 진입 즉시 캡차가 걸려 있으면 입력하지 않고 종료
  const preBlock = await page.locator(CAPTCHA_SELECTOR).first().isVisible({ timeout: 1000 }).catch(() => false);
  if (preBlock) {
    console.error('[로그인] CAPTCHA 감지 — 수동 로그인 후 쿠키 갱신 필요');
    await takeScreenshot(page, 'login-blocked');
    return { ok: false, reason: 'captcha_required' };
  }

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

  await page.locator('button#log\\.login[type="submit"]').click();
  await page.waitForTimeout(3000);

  const blocked = await detectLoginBlock(page);
  if (!blocked.ok) {
    console.error(`[로그인] 차단 감지(${blocked.reason}) — 수동 로그인 후 쿠키 갱신 필요`);
    await takeScreenshot(page, 'login-blocked');
    return blocked;
  }

  console.log('[로그인] 성공');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 세션 확보: storageState → env 쿠키 → ID/PW → 에디터 접근 재확인
// ---------------------------------------------------------------------------
export async function ensureLoggedIn(page: Page, context: BrowserContext): Promise<LoginResult> {
  if (await checkLoginStatus(page)) return { ok: true };

  // storageState 실패 시 env 쿠키로 폴백
  const cookies = loadCookiesFromEnv();
  if (cookies) {
    await context.addCookies(cookies);
    console.log(`[쿠키] env에서 ${cookies.length}개 주입됨`);
    if (await checkLoginStatus(page)) return { ok: true };
  }

  // 그래도 로그인 안 됨 → ID/PW 폴백
  console.log('[로그인] 쿠키 만료 — ID/PW 로그인 시도');
  const login = await loginToNaver(page);
  if (!login.ok) return login.reason === 'credentials_missing' ? { ok: false, reason: 'session_expired' } : login;

  // ID/PW 성공 후에도 에디터 접근이 안 되면 게시 단계에서 오래 헤매지 않도록 여기서 끊는다.
  if (await checkLoginStatus(page)) return { ok: true };
  const after = await detectLoginBlock(page);
  return after.ok ? { ok: false, reason: 'login_failed' } : after;
}
