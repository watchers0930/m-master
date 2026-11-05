// scripts/naver-blog/screenshot.ts — 실패 진단용 스크린샷 (원본 publish-naver-blog.ts에서 이동)
import * as fs from 'fs';
import * as path from 'path';
import type { Page } from 'playwright';
import { SCREENSHOT_DIR, SCREENSHOT_RETENTION_MS } from './config';

// ---------------------------------------------------------------------------
// 스크린샷 유틸
// ---------------------------------------------------------------------------
export async function takeScreenshot(page: Page, name: string): Promise<void> {
  try {
    if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true, mode: 0o700 });
    const filepath = path.join(SCREENSHOT_DIR, `${name}-${Date.now()}.png`);
    await page.screenshot({ path: filepath, fullPage: false, timeout: 10_000 });
    console.log(`[스크린샷] ${filepath}`);
  } catch (err) {
    // 진단 보조 기능 — 실패해도 본 흐름(fail 보고)을 막지 않는다.
    console.warn(`[스크린샷] 실패: ${err instanceof Error ? err.message : err}`);
  }
}

/** 보관 기간이 지난 스크린샷 정리(러너 디스크에 무기한 누적 방지). */
export function pruneScreenshots(now = Date.now()): void {
  try {
    if (!fs.existsSync(SCREENSHOT_DIR)) return;
    for (const name of fs.readdirSync(SCREENSHOT_DIR)) {
      if (!name.endsWith('.png')) continue;
      const file = path.join(SCREENSHOT_DIR, name);
      if (now - fs.statSync(file).mtimeMs > SCREENSHOT_RETENTION_MS) fs.unlinkSync(file);
    }
  } catch { /* 정리 실패는 무시 */ }
}
