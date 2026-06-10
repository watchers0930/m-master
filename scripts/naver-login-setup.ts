#!/usr/bin/env npx tsx
// scripts/naver-login-setup.ts — 네이버 수동 로그인 → persistent context 세션 저장
//
// 1회성 실행: npx tsx scripts/naver-login-setup.ts
// 브라우저가 열리면 수동으로 네이버 로그인 → 완료되면 자동으로 세션 저장

import { chromium } from 'playwright';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const USER_DATA_DIR = path.join(os.homedir(), '.naver-blog-browser');

async function main(): Promise<void> {
  console.log('=== 네이버 로그인 설정 ===');
  console.log(`브라우저 프로필: ${USER_DATA_DIR}`);

  if (!fs.existsSync(USER_DATA_DIR)) fs.mkdirSync(USER_DATA_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
    viewport: { width: 1280, height: 900 },
    locale: 'ko-KR',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  const page = context.pages()[0] ?? await context.newPage();

  // 네이버 로그인 페이지로 이동
  await page.goto('https://nid.naver.com/nidlogin.login', { waitUntil: 'domcontentloaded' });

  console.log('\n────────────────────────────────────');
  console.log('브라우저에서 네이버에 로그인해 주세요.');
  console.log('로그인 완료 후 블로그 글쓰기 페이지가');
  console.log('정상 접근되는지 자동 확인합니다.');
  console.log('────────────────────────────────────\n');

  // 로그인 완료 대기 (최대 5분)
  // 로그인 페이지에 있는 동안은 건드리지 않고 URL만 확인
  const timeout = 5 * 60 * 1000;
  const start = Date.now();
  let loggedIn = false;

  while (Date.now() - start < timeout) {
    await page.waitForTimeout(3000);

    try {
      const url = page.url();

      // 아직 로그인/CAPTCHA 페이지에 있으면 대기 (페이지 이동 안 함)
      if (url.includes('nidlogin') || url.includes('captcha') || url.includes('deviceConfirm')) {
        continue;
      }

      // 로그인 페이지를 벗어남 → 세션 쿠키로 확인
      if (url.includes('naver.com')) {
        const cookies = await context.cookies('https://naver.com');
        const hasSession = cookies.some((c) => c.name === 'NID_AUT' || c.name === 'NID_SES');
        if (hasSession) {
          loggedIn = true;
          break;
        }
      }
    } catch {
      // 페이지 이동 중 에러 무시
    }
  }

  if (loggedIn) {
    console.log('✅ 로그인 성공! 블로그 글쓰기 접근 확인 완료.');
    console.log(`   세션이 ${USER_DATA_DIR}에 저장되었습니다.`);
    console.log('   이제 GitHub Actions 자동발행이 이 세션을 사용합니다.');

    // 쿠키 백업도 저장
    const cookies = await context.cookies();
    const cookiesPath = path.join(process.cwd(), 'naver-cookies.json');
    fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
    console.log(`   쿠키 백업: ${cookiesPath} (${cookies.length}개)`);
  } else {
    console.error('❌ 5분 내 로그인이 완료되지 않았습니다.');
    console.error('   다시 실행해 주세요: npx tsx scripts/naver-login-setup.ts');
  }

  await context.close();
}

main().catch((err) => {
  console.error('오류:', err);
  process.exit(1);
});
