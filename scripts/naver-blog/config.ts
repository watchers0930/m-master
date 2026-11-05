// scripts/naver-blog/config.ts — 작업자 공통 설정(환경변수·경로·시간 상한)
//
// 환경변수:
//   NAVER_COOKIES        — base64 JSON 쿠키 (GitHub secret, 폴백용)
//   NAVER_ID             — 네이버 아이디 (쿠키 만료 폴백)
//   NAVER_PW             — 네이버 비밀번호
//   BLOG_PUBLISH_API_KEY — M-Master 작업자 인증 키 (서버 env BLOG_PUBLISH_API_KEY와 동일 값)
//   BLOG_PUBLISH_OWNER_ID — 이 작업자가 게시할 유일한 소유자 ID(네이버 계정 1개 = 소유자 1명). 서버 BLOG_PUBLISH_OWNER_IDS에 포함돼야 함
//   APP_URL              — https://m-master.vercel.app
import * as os from 'os';
import * as path from 'path';

export const APP_URL = process.env.APP_URL ?? 'https://m-master.vercel.app';
export const API_KEY = process.env.BLOG_PUBLISH_API_KEY ?? '';
export const OWNER_ID = (process.env.BLOG_PUBLISH_OWNER_ID ?? '').trim();
export const DRY_RUN = process.argv.includes('--dry-run');
// 스크린샷은 공개 저장소 artifact로 올리지 않는다(계정·미승인 원고 노출 방지). 러너 로컬에만 보관.
export const SCREENSHOT_DIR = process.env.NAVER_SCREENSHOT_DIR || path.join(process.cwd(), 'screenshots');
export const SCREENSHOT_RETENTION_MS = 7 * 24 * 3600_000;
// storageState: 로그인 셋업 스크립트가 저장한 세션 파일
export const STATE_PATH = path.join(os.homedir(), '.naver-blog-state.json');

// 브라우저 공통 옵션 (anti-detection)
export const BROWSER_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--no-sandbox',
  '--disable-dev-shm-usage',
];
export const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// 시간 상한 — 어느 단계도 무기한 대기하지 않도록 한다.
export const ACTION_TIMEOUT_MS = 20_000;      // Playwright 클릭·대기 기본값
export const NAVIGATION_TIMEOUT_MS = 30_000;  // Playwright 페이지 이동 기본값
export const API_TIMEOUT_MS = 15_000;         // 서버 API 1회 호출
export const ITEM_DEADLINE_MS = 10 * 60_000;  // 글 1건 게시 전체(본문 타이핑 포함). workflow step 상한 15분 안에 로그인(≤3분)과 함께 끝나도록
