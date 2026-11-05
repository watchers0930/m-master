// scripts/naver-blog/editor-format.ts — SE 에디터 서식(헤딩·인라인 서식·색상·표) (원본에서 이동, 동작 동일)
import type { Page } from 'playwright';

// ---------------------------------------------------------------------------
// SE 에디터: 헤딩 스타일 적용 (문단 드롭다운 → 제목N 선택)
// ---------------------------------------------------------------------------
export async function applyHeadingStyle(page: Page, level: 2 | 3): Promise<boolean> {
  const fl = page.frameLocator('iframe[name="mainFrame"]');
  try {
    // SE 에디터 문단 스타일 드롭다운 열기
    await fl.locator('button.se-text-paragraph-button').click();
    await page.waitForTimeout(400);
    // 제목 레벨 선택
    const selector = level === 2
      ? '[data-style="heading2"], [data-value="heading2"]'
      : '[data-style="heading3"], [data-value="heading3"]';
    await fl.locator(selector).click();
    await page.waitForTimeout(200);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// SE 에디터: 인라인 서식 적용하며 텍스트 타이핑
// **bold** → Ctrl+B + 형광펜, *italic* → Ctrl+I 토글
// ---------------------------------------------------------------------------
export const MOD_KEY = process.platform === 'darwin' ? 'Meta' : 'Control';

export async function typeWithFormatting(page: Page, text: string): Promise<void> {
  // **bold**와 *italic* 구간 분리
  const parts = text.split(/(\*\*[^*]+?\*\*|\*[^*]+?\*)/g);

  for (const part of parts) {
    if (!part) continue;

    if (part.startsWith('**') && part.endsWith('**')) {
      // 강조 텍스트 — 볼드 + 딥블루 + 형광펜 배경
      const inner = part.slice(2, -2);
      await setHighlightColor(page, COLOR_HIGHLIGHT);
      await setTextColor(page, COLOR_ACCENT);
      await page.keyboard.press(`${MOD_KEY}+b`);
      await page.keyboard.type(inner, { delay: 5 });
      await page.keyboard.press(`${MOD_KEY}+b`);
      await clearHighlightColor(page);
      await setTextColor(page, COLOR_NORMAL);
    } else if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      // 이탤릭 텍스트
      const inner = part.slice(1, -1);
      await page.keyboard.press(`${MOD_KEY}+i`);
      await page.keyboard.type(inner, { delay: 5 });
      await page.keyboard.press(`${MOD_KEY}+i`);
    } else {
      // 일반 텍스트 — 소프트 블랙
      await page.keyboard.type(part, { delay: 5 });
    }
  }
}

/** 인용문(blockquote) 한 줄 타이핑 — 이탤릭 + 회색 + 좌측 바 느낌 */
export async function typeBlockquote(page: Page, text: string): Promise<void> {
  await setTextColor(page, COLOR_QUOTE);
  await page.keyboard.press(`${MOD_KEY}+i`);
  await page.keyboard.type(`❝ ${text}`, { delay: 5 });
  await page.keyboard.press(`${MOD_KEY}+i`);
  await setTextColor(page, COLOR_NORMAL);
}

// ---------------------------------------------------------------------------
// 폰트 색상 (AI 작성 느낌 탈피 — 강조·일반·인용 시각 분리)
// ---------------------------------------------------------------------------
export const COLOR_NORMAL = '#333333';     // 일반 텍스트 (순흑 대신 소프트 블랙)
export const COLOR_ACCENT = '#1a5276';     // 강조(볼드) — 딥블루
export const COLOR_HEADING = '#1b2631';    // 소제목(H2/H3) — 진한 남색
export const COLOR_QUOTE = '#555555';      // 인용문(blockquote) — 회색
export const COLOR_TABLE_HEAD = '#2c3e50'; // 테이블 헤더 — 다크 블루그레이
export const COLOR_HIGHLIGHT = '#fff59d';  // 핵심 포인트 — 옅은 노란 형광펜

/** SE 에디터 iframe 내 execCommand로 폰트 색상 변경 */
export async function setTextColor(page: Page, color: string): Promise<void> {
  try {
    const frame = page.frame('mainFrame');
    if (frame) {
      await frame.evaluate((c) => {
        document.execCommand('foreColor', false, c);
      }, color);
    }
  } catch { /* 색상 변경 실패 시 기본색 유지 — 무시 */ }
}

/** SE 에디터 iframe 내 execCommand로 형광펜 배경 변경 */
export async function setHighlightColor(page: Page, color: string): Promise<void> {
  try {
    const frame = page.frame('mainFrame');
    if (frame) {
      await frame.evaluate((c) => {
        document.execCommand('hiliteColor', false, c);
        document.execCommand('backColor', false, c);
      }, color);
    }
  } catch { /* 배경색 변경 실패 시 볼드/색상만 유지 */ }
}

export async function clearHighlightColor(page: Page): Promise<void> {
  try {
    const frame = page.frame('mainFrame');
    if (frame) {
      await frame.evaluate(() => {
        document.execCommand('hiliteColor', false, 'transparent');
        document.execCommand('backColor', false, 'transparent');
      });
    }
  } catch { /* 배경색 초기화 실패 시 이후 색상 설정으로 보정 */ }
}

/** 마크다운 테이블을 SE 에디터에서 볼드 헤더 + 줄바꿈 텍스트로 렌더링 */
export async function typeTableBlock(page: Page, tableLines: string[]): Promise<void> {
  // 첫 줄: 헤더, 두번째: 구분선, 나머지: 데이터
  const headers = tableLines[0].split('|').filter(c => c.trim()).map(c => c.trim());
  const dataRows = tableLines.slice(2).map(row =>
    row.split('|').filter(c => c.trim()).map(c => c.trim()),
  );

  // 헤더 볼드 + 다크 블루그레이
  await setTextColor(page, COLOR_TABLE_HEAD);
  await page.keyboard.press(`${MOD_KEY}+b`);
  await page.keyboard.type(headers.join('  │  '), { delay: 5 });
  await page.keyboard.press(`${MOD_KEY}+b`);
  await setTextColor(page, COLOR_NORMAL);
  await page.keyboard.press('Enter');

  // 구분선
  await page.keyboard.type('─'.repeat(Math.min(headers.join('  │  ').length, 50)), { delay: 2 });
  await page.keyboard.press('Enter');

  // 데이터 행 — 일반 색상
  for (const row of dataRows) {
    await page.keyboard.type(row.join('  │  '), { delay: 5 });
    await page.keyboard.press('Enter');
  }
}

/** 태그 줄에서 해시태그 추출 */
export function extractTags(tagLine: string): string[] {
  const cleaned = tagLine.replace(/^\*{0,2}태그:\*{0,2}\s*/, '');
  return cleaned.match(/#[^\s#]+/g) ?? [];
}
