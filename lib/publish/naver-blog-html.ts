// lib/publish/naver-blog-html.ts — 마크다운 콘텐츠 → 네이버 블로그 SE 에디터용 HTML 변환
// Playwright가 클립보드에 이 HTML을 넣고 붙여넣기하면 SE 에디터가 서식을 인식함

// ---------------------------------------------------------------------------
// HTML 이스케이프
// ---------------------------------------------------------------------------
function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// 마크다운 인라인 서식 → HTML
// ---------------------------------------------------------------------------
function inlineFormat(line: string): string {
  return line
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

// ---------------------------------------------------------------------------
// 메인: 마크다운 텍스트 → 네이버 블로그용 HTML
// ---------------------------------------------------------------------------
export function markdownToBlogHtml(
  text: string,
  bodyImageUrls: string[] = [],
): string {
  let imgIdx = 0;
  const lines = text.split('\n');
  const htmlParts: string[] = [];
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 빈 줄
    if (!trimmed) {
      if (inList) { htmlParts.push('</ul>'); inList = false; }
      continue;
    }

    // 이미지 마커: [이미지: 설명]
    const imgMatch = trimmed.match(/^\[이미지:\s*(.+?)\]\s*$/);
    if (imgMatch) {
      if (inList) { htmlParts.push('</ul>'); inList = false; }
      const desc = imgMatch[1];
      const url = bodyImageUrls[imgIdx++];
      if (url) {
        htmlParts.push(
          `<p><img src="${esc(url)}" alt="${esc(desc)}" style="max-width:100%;height:auto;"></p>`,
        );
      }
      continue;
    }

    // 헤딩: ## 소제목
    const h2Match = trimmed.match(/^##\s+(.+)$/);
    if (h2Match) {
      if (inList) { htmlParts.push('</ul>'); inList = false; }
      htmlParts.push(`<h2>${inlineFormat(esc(h2Match[1]))}</h2>`);
      continue;
    }

    const h3Match = trimmed.match(/^###\s+(.+)$/);
    if (h3Match) {
      if (inList) { htmlParts.push('</ul>'); inList = false; }
      htmlParts.push(`<h3>${inlineFormat(esc(h3Match[1]))}</h3>`);
      continue;
    }

    // 리스트: - 항목 또는 * 항목
    const listMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (listMatch) {
      if (!inList) { htmlParts.push('<ul>'); inList = true; }
      htmlParts.push(`<li>${inlineFormat(esc(listMatch[1]))}</li>`);
      continue;
    }

    // 인용: > 텍스트
    const quoteMatch = trimmed.match(/^>\s+(.+)$/);
    if (quoteMatch) {
      if (inList) { htmlParts.push('</ul>'); inList = false; }
      htmlParts.push(`<blockquote>${inlineFormat(esc(quoteMatch[1]))}</blockquote>`);
      continue;
    }

    // 구분선: --- 또는 ***
    if (/^[-*]{3,}$/.test(trimmed)) {
      if (inList) { htmlParts.push('</ul>'); inList = false; }
      htmlParts.push('<hr>');
      continue;
    }

    // 일반 문단
    if (inList) { htmlParts.push('</ul>'); inList = false; }
    htmlParts.push(`<p>${inlineFormat(esc(trimmed))}</p>`);
  }

  if (inList) htmlParts.push('</ul>');

  return htmlParts.join('\n');
}
