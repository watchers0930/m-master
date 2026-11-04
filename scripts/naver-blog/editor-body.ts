// scripts/naver-blog/editor-body.ts — 본문 입력(서식 적용 + 이미지 교차 배치) (원본에서 이동, 동작 동일)
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Page } from 'playwright';
import {
  applyHeadingStyle, typeWithFormatting, typeBlockquote, setTextColor, typeTableBlock, extractTags,
  MOD_KEY, COLOR_NORMAL, COLOR_HEADING,
} from './editor-format';

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
// SE 에디터: 이미지 업로드
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
// 이미지 삽입 (다운로드 → 업로드 → 임시파일 삭제)
// ---------------------------------------------------------------------------
async function insertImage(
  page: Page,
  imgUrl: string,
  imgIndex: number,
): Promise<boolean> {
  await page.keyboard.press('Enter');
  const tmpPath = await downloadImage(imgUrl, imgIndex);
  if (!tmpPath) return false;
  const ok = await uploadImage(page, tmpPath);
  fs.unlinkSync(tmpPath);
  return ok;
}

// ---------------------------------------------------------------------------
// 에디터: 본문 입력 — 서식 적용 + 이미지 교차 배치
// 규칙: (1) 텍스트 3줄 이상 후 첫 이미지 (2) 이미지 연속 배치 금지
// ---------------------------------------------------------------------------
const IMAGE_MARKER = /^\[이미지:.*?\]\s*$/;
const HEADING_RE = /^(#{2,3})\s+(.+)$/;
const TABLE_HEADER_RE = /^\|.+\|$/;
const TABLE_SEPARATOR_RE = /^\|[\s:-]+\|$/;
const TAG_LINE_RE = /^\*{0,2}태그:\*{0,2}\s*#/;
const HR_RE = /^---+$/;
const BLOCKQUOTE_RE = /^>\s*(.+)/;

export async function fillBody(
  page: Page,
  text: string,
  bodyImageUrls: string[],
): Promise<{ tags: string[] }> {
  const fl = page.frameLocator('iframe[name="mainFrame"]');
  await fl.locator('.se-section-text').click();
  await page.waitForTimeout(500);

  const lines = text.split('\n');
  let imageIndex = 0;
  let textLineCount = 0;
  let lastWasImage = false;
  let needsClickAfterImage = false;
  const deferredImages: { url: string; idx: number }[] = [];
  const collectedTags: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // 빈 줄
    if (!line) {
      await page.keyboard.press('Enter');
      continue;
    }

    // H1 제목 (#) — 스킵
    if (/^#\s+/.test(line) && !line.startsWith('##')) {
      continue;
    }

    // --- 구분선 — 태그 직전의 HR은 스킵
    if (HR_RE.test(line)) {
      // 다음 비공백 줄이 태그줄이면 HR + 태그 모두 스킵 (본문에 넣지 않음)
      let nextIdx = i + 1;
      while (nextIdx < lines.length && !lines[nextIdx].trim()) nextIdx++;
      if (nextIdx < lines.length && TAG_LINE_RE.test(lines[nextIdx].trim())) {
        continue; // HR 스킵, 태그는 아래에서 처리
      }
      await page.keyboard.press('Enter');
      continue;
    }

    // 태그 줄 — 본문에 넣지 않고 수집
    if (TAG_LINE_RE.test(line)) {
      collectedTags.push(...extractTags(line));
      continue;
    }

    // 마크다운 테이블 감지 (| 헤더 | ... | + |---|---| 패턴)
    if (TABLE_HEADER_RE.test(line) && i + 1 < lines.length && TABLE_SEPARATOR_RE.test(lines[i + 1].trim())) {
      const tableLines: string[] = [line];
      let j = i + 1;
      while (j < lines.length && TABLE_HEADER_RE.test(lines[j].trim())) {
        tableLines.push(lines[j].trim());
        j++;
      }
      if (needsClickAfterImage) {
        await fl.locator('.se-section-text').last().click();
        await page.waitForTimeout(300);
        needsClickAfterImage = false;
      }
      await typeTableBlock(page, tableLines);
      textLineCount += tableLines.length;
      lastWasImage = false;
      i = j - 1; // 테이블 줄 건너뛰기
      continue;
    }

    // 이미지 마커
    if (IMAGE_MARKER.test(line)) {
      const imgUrl = bodyImageUrls[imageIndex];
      const idx = imageIndex;
      imageIndex++;
      if (!imgUrl) continue;

      if (textLineCount < 3 || lastWasImage) {
        deferredImages.push({ url: imgUrl, idx });
        continue;
      }

      await insertImage(page, imgUrl, idx);
      lastWasImage = true;
      needsClickAfterImage = true;
      continue;
    }

    // 이미지 직후 텍스트 → 새 텍스트 영역 클릭
    if (needsClickAfterImage) {
      await fl.locator('.se-section-text').last().click();
      await page.waitForTimeout(300);
      needsClickAfterImage = false;
    }

    // 지연된 이미지 flush (텍스트 3줄 이상, 직전 이미지 아님)
    if (deferredImages.length > 0 && textLineCount >= 3 && !lastWasImage) {
      const img = deferredImages.shift()!;
      await insertImage(page, img.url, img.idx);
      await fl.locator('.se-section-text').last().click();
      await page.waitForTimeout(300);
      // eslint-disable-next-line no-useless-assignment -- 원본 동작 그대로 이동(무해한 중복 대입)
      lastWasImage = false;
    }

    // H2/H3 헤딩 — 진한 남색 + SE 헤딩 스타일
    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      const level = headingMatch[1].length as 2 | 3;
      const headingText = headingMatch[2].replace(/[#*]/g, '').trim();

      const styled = await applyHeadingStyle(page, level);
      await setTextColor(page, COLOR_HEADING);
      if (!styled) await page.keyboard.press(`${MOD_KEY}+b`);
      await page.keyboard.type(headingText, { delay: 10 });
      if (!styled) await page.keyboard.press(`${MOD_KEY}+b`);
      await setTextColor(page, COLOR_NORMAL);

      await page.keyboard.press('Enter');
      textLineCount++;
      lastWasImage = false;
      await page.waitForTimeout(50);
      continue;
    }

    // 인용문(blockquote) — 이탤릭 + 회색 + 인용부호
    const quoteMatch = line.match(BLOCKQUOTE_RE);
    if (quoteMatch) {
      const quoteText = quoteMatch[1].replace(/\*\*/g, '').trim();
      await typeBlockquote(page, quoteText);
      if (i < lines.length - 1) await page.keyboard.press('Enter');
      textLineCount++;
      lastWasImage = false;
      await page.waitForTimeout(50);
      continue;
    }

    // 불릿 리스트
    const bulletLine = line.replace(/^[-*]\s+/, '• ');

    // 일반 텍스트 색상 설정 후 인라인 서식 적용
    await setTextColor(page, COLOR_NORMAL);
    await typeWithFormatting(page, bulletLine);
    if (i < lines.length - 1) await page.keyboard.press('Enter');
    textLineCount++;
    lastWasImage = false;
    await page.waitForTimeout(50);

    // 지연 이미지 flush (3줄마다)
    if (deferredImages.length > 0 && textLineCount >= 3 && (textLineCount % 3 === 0)) {
      const img = deferredImages.shift()!;
      await page.keyboard.press('Enter');
      await insertImage(page, img.url, img.idx);
      await fl.locator('.se-section-text').last().click();
      await page.waitForTimeout(300);
      lastWasImage = false;
    }
  }

  // 남은 지연 이미지 모두 삽입
  for (const img of deferredImages) {
    if (needsClickAfterImage) {
      await fl.locator('.se-section-text').last().click();
      await page.waitForTimeout(300);
    }
    await insertImage(page, img.url, img.idx);
    needsClickAfterImage = true;
  }

  await page.waitForTimeout(500);
  console.log(`[본문] 타이핑 완료 (이미지 ${imageIndex}개, 태그 ${collectedTags.length}개, 서식 적용)`);
  return { tags: collectedTags };
}
