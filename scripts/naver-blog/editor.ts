// scripts/naver-blog/editor.ts — SE 에디터 팝업·제목·구분선·푸터·태그 (원본에서 이동, 동작 동일)
import type { Page } from 'playwright';
import { MOD_KEY } from './editor-format';

// ---------------------------------------------------------------------------
// SE 에디터: 자동 저장 복구 팝업 처리
// ---------------------------------------------------------------------------
export async function dismissDraftRecoveryPopup(page: Page): Promise<void> {
  const frame = page.frame('mainFrame');
  if (!frame) return;

  const hasPopup = await frame
    .locator('.se-popup-alert-confirm.blog-se-alert, [data-name*="se-popup-alert"], .se-popup-dim')
    .first()
    .isVisible({ timeout: 3000 })
    .catch(() => false);
  if (!hasPopup) return;

  const popupText = await frame
    .locator('.se-popup-alert-confirm.blog-se-alert, [data-name*="se-popup-alert"]')
    .first()
    .innerText({ timeout: 1000 })
    .catch(() => '');
  console.log(`[팝업] 에디터 알림 감지: ${popupText.replace(/\s+/g, ' ').trim() || '내용 없음'}`);

  const clicked = await frame.evaluate(() => {
    const popup = document.querySelector(
      '.se-popup-alert-confirm.blog-se-alert, [data-name*="se-popup-alert"]',
    );
    if (!popup) return false;

    const candidates = Array.from(
      popup.querySelectorAll<HTMLElement>('button, a, [role="button"]'),
    );
    const preferred = candidates.find((el) => {
      const text = (el.textContent ?? '').replace(/\s+/g, '');
      return text.includes('취소') || text.includes('닫기') || text.includes('확인') || text.includes('새글');
    });
    const target = preferred ?? candidates[0];
    target?.click();
    return Boolean(target);
  }).catch(() => false);

  if (!clicked) {
    await page.keyboard.press('Escape').catch(() => {});
  }

  await page.waitForTimeout(1000);

  const stillVisible = await frame
    .locator('.se-popup-dim, .se-popup-alert-confirm.blog-se-alert, [data-name*="se-popup-alert"]')
    .first()
    .isVisible({ timeout: 1000 })
    .catch(() => false);

  if (stillVisible) {
    await frame.evaluate(() => {
      document
        .querySelectorAll('.se-popup-dim, .se-popup-alert-confirm.blog-se-alert, [data-name*="se-popup-alert"]')
        .forEach((el) => el.remove());
    }).catch(() => {});
    await page.waitForTimeout(300);
    console.log('[팝업] 닫기 실패 레이어 강제 제거');
    return;
  }

  console.log('[팝업] 에디터 알림 닫음');
}

// ---------------------------------------------------------------------------
// 에디터: 제목 입력
// ---------------------------------------------------------------------------
export async function fillTitle(page: Page, title: string): Promise<void> {
  const fl = page.frameLocator('iframe[name="mainFrame"]');
  await dismissDraftRecoveryPopup(page);
  await fl.locator('.se-section-documentTitle').click();
  await page.waitForTimeout(500);
  await page.keyboard.type(title, { delay: 30 });
  await page.waitForTimeout(300);
  console.log(`[제목] "${title.substring(0, 40)}..." 입력 완료`);
}

// ---------------------------------------------------------------------------
// SE 에디터: 구분선 삽입
// ---------------------------------------------------------------------------
async function insertDivider(page: Page): Promise<void> {
  const fl = page.frameLocator('iframe[name="mainFrame"]');
  try {
    // SE 에디터 구분선 버튼 클릭
    await fl.locator('button.se-toolbar-button-line, button[data-name="horizontalLine"]').click();
    await page.waitForTimeout(500);
    // 구분선 스타일 팝업에서 첫 번째(기본) 스타일 선택
    const lineOption = fl.locator('.se-line-toolbar-button, .se-popup-button-line').first();
    if (await lineOption.isVisible({ timeout: 1000 }).catch(() => false)) {
      await lineOption.click();
      await page.waitForTimeout(300);
    }
  } catch {
    // 구분선 삽입 실패 시 텍스트로 대체
    await page.keyboard.press('Enter');
    await page.keyboard.type('━━━━━━━━━━━━━━━━━━━━━━━━━━━━', { delay: 2 });
    await page.keyboard.press('Enter');
  }
  console.log('[구분선] 삽입 완료');
}

// ---------------------------------------------------------------------------
// 베스트라 홍보 푸터 삽입 (구분선 + 역할 설명 + 도메인)
// ---------------------------------------------------------------------------
export async function insertVestraFooter(page: Page, topic: string): Promise<void> {
  const fl = page.frameLocator('iframe[name="mainFrame"]');

  // 본문 마지막 텍스트 영역에 커서 이동
  await fl.locator('.se-section-text').last().click();
  await page.waitForTimeout(300);

  // 빈 줄 + 구분선
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await insertDivider(page);

  // 구분선 아래 텍스트 영역 클릭
  await fl.locator('.se-section-text').last().click();
  await page.waitForTimeout(300);

  // 베스트라 소개 문구
  await page.keyboard.press('Enter');
  await page.keyboard.press(`${MOD_KEY}+b`);
  await page.keyboard.type('VESTRA | AI 부동산 권리분석·시세분석 서비스', { delay: 10 });
  await page.keyboard.press(`${MOD_KEY}+b`);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');

  await page.keyboard.type(
    '등기부등본 변동 감시부터 계약서 위험 조항 분석까지, AI가 알아서 챙겨드립니다.',
    { delay: 5 },
  );
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');

  await page.keyboard.type(
    '근저당·가압류·소유권 변경 — 모르는 사이 생기는 위험을 실시간으로 알려드립니다.',
    { delay: 5 },
  );
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');

  await page.keyboard.type('https://vestra-plum.vercel.app', { delay: 5 });

  await page.waitForTimeout(300);
  console.log('[베스트라] 홍보 푸터 삽입 완료');
}

// ---------------------------------------------------------------------------
// SE 에디터: 태그 입력 (발행 설정 다이얼로그의 태그 필드에 삽입)
// ---------------------------------------------------------------------------
export async function insertTags(page: Page, tags: string[], keywords: string[]): Promise<void> {
  // 본문에서 추출한 태그 + content keywords 합치고 중복 제거
  const allTags = [...new Set([
    ...tags.map(t => t.replace(/^#/, '').trim()),
    ...keywords.map(k => k.trim()),
  ])].filter(t => t.length >= 2).slice(0, 10);

  if (allTags.length === 0) return;

  const fl = page.frameLocator('iframe[name="mainFrame"]');
  try {
    // SE 에디터 태그 입력 필드 찾기
    const tagInput = fl.locator('input.se-tag-input__input, input[placeholder*="태그"], input[placeholder*="tag"]').first();
    if (await tagInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      for (const tag of allTags) {
        await tagInput.click();
        await page.keyboard.type(tag, { delay: 10 });
        await page.keyboard.press('Enter');
        await page.waitForTimeout(200);
      }
      console.log(`[태그] SE 에디터 태그 입력 완료 (${allTags.length}개)`);
      return;
    }
  } catch { /* 태그 입력 필드 없으면 아래 fallback */ }

  // Fallback: 본문 하단에 태그 텍스트로 입력
  try {
    await fl.locator('.se-section-text').last().click();
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    const tagText = allTags.map(t => `#${t}`).join(' ');
    await page.keyboard.type(tagText, { delay: 5 });
    console.log(`[태그] 본문 하단 태그 입력 완료 (${allTags.length}개)`);
  } catch (err) {
    console.warn(`[태그] 입력 실패: ${err instanceof Error ? err.message : err}`);
  }
}

