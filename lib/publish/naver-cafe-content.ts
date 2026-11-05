// lib/publish/naver-cafe-content.ts — 네이버 카페 본문 HTML·푸터·태그 생성(순수 함수). 전송은 naver-cafe.ts.
// ---------------------------------------------------------------------------
// 마크다운 → HTML 변환 (네이버 카페 API는 HTML content 지원)
// 블로그 수준의 구조(소제목, 강조, 목록, 이미지 플레이스홀더)를 유지한다.
// ---------------------------------------------------------------------------
/** 마크다운을 네이버 카페용 HTML로 변환 (인라인 스타일 최소화 — 스팸 필터 방지) */
export function buildNaverCafeContent(text: string, imageUrls?: string[]): string {
  const imgs = (imageUrls ?? []).filter(u => u && u.trim() !== '');
  let imgIdx = 0;
  const lines = text.split('\n');
  const htmlParts: string[] = [];
  let inList = false;
  let inTable = false;
  let tableRows: string[][] = [];

  function flushList() {
    if (inList) { htmlParts.push('</ul>'); inList = false; }
  }

  function flushTable() {
    if (!inTable || tableRows.length === 0) return;
    const [header, ...body] = tableRows;
    htmlParts.push('<table>');
    htmlParts.push('<thead><tr>' + header.map(c => `<th>${inlineMd(c)}</th>`).join('') + '</tr></thead>');
    if (body.length > 0) {
      htmlParts.push('<tbody>');
      for (const row of body) {
        htmlParts.push('<tr>' + row.map(c => `<td>${inlineMd(c)}</td>`).join('') + '</tr>');
      }
      htmlParts.push('</tbody>');
    }
    htmlParts.push('</table>');
    inTable = false;
    tableRows = [];
  }

  for (const raw of lines) {
    const line = raw.trimEnd();

    // 테이블 행 감지 (| col | col |)
    if (/^\|(.+)\|$/.test(line.trim())) {
      // 구분선 행(|---|---| 등)은 스킵
      if (/^\|[\s:|-]+\|$/.test(line.trim())) {
        continue;
      }
      flushList();
      const cells = line.trim().slice(1, -1).split('|').map(c => c.trim());
      if (!inTable) inTable = true;
      tableRows.push(cells);
      continue;
    }

    // 테이블 행이 아닌 줄 → 테이블 종료
    if (inTable) flushTable();

    // 빈 줄 → 목록 종료 (문단 간격은 헤딩 앞에서만 삽입)
    if (line.trim() === '') {
      flushList();
      continue;
    }

    // 이미지 플레이스홀더 → <img> 태그 삽입 (URL이 있는 경우)
    if (/^\[이미지:\s*.+\]$/.test(line)) {
      flushList();
      if (imgIdx < imgs.length) {
        // 속성 탈출·javascript: 차단 — http(s) URL만, 속성값 이스케이프
        const src = imgs[imgIdx];
        if (/^https?:\/\//i.test(src)) htmlParts.push(`<p><img src="${escapeHtml(src)}" alt="" /></p>`);
        imgIdx++;
      }
      continue;
    }

    // 헤딩 (타이틀 위에만 <br><br> 삽입)
    const h3Match = line.match(/^###\s+(.+)$/);
    if (h3Match) {
      flushList();
      if (htmlParts.length > 0) htmlParts.push('<br><br>');
      htmlParts.push(`<h3>${inlineMd(h3Match[1])}</h3>`);
      continue;
    }
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      flushList();
      if (htmlParts.length > 0) htmlParts.push('<br><br>');
      htmlParts.push(`<h2>${inlineMd(h2Match[1])}</h2>`);
      continue;
    }
    const h1Match = line.match(/^#\s+(.+)$/);
    if (h1Match) {
      flushList();
      if (htmlParts.length > 0) htmlParts.push('<br><br>');
      htmlParts.push(`<h1>${inlineMd(h1Match[1])}</h1>`);
      continue;
    }

    // 목록 항목
    const liMatch = line.match(/^[-*]\s+(.+)$/);
    if (liMatch) {
      if (!inList) { htmlParts.push('<ul>'); inList = true; }
      htmlParts.push(`<li>${inlineMd(liMatch[1])}</li>`);
      continue;
    }

    // 인용 (네이버 카페 blockquote 내부는 HTML 태그 미지원 — 텍스트만)
    const bqMatch = line.match(/^>\s+(.+)$/);
    if (bqMatch) {
      flushList();
      const plain = bqMatch[1].replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');
      htmlParts.push(`<blockquote>${escapeHtml(plain)}</blockquote>`);
      continue;
    }

    // 구분선
    if (/^---+$/.test(line.trim())) {
      flushList();
      htmlParts.push('<hr>');
      continue;
    }

    // 일반 문단
    flushList();
    htmlParts.push(`<p>${inlineMd(line)}</p>`);
  }

  if (inTable) flushTable();
  if (inList) htmlParts.push('</ul>');
  return htmlParts.join('\n');
}

/** HTML 특수문자 이스케이프 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 인라인 마크다운 변환 (볼드, 이탤릭) — XSS 방지를 위해 먼저 이스케이프 */
function inlineMd(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*]+)\*/g, '<i>$1</i>');
}

// ---------------------------------------------------------------------------
// 카페 글 하단 고정 푸터 (VESTRA 소개 + 도메인 + 해시태그)
// ---------------------------------------------------------------------------
export const CAFE_FOOTER = [
  '<hr>',
  '<p></p>',
  '<p><b>VESTRA | AI 부동산 권리분석·시세분석 서비스</b></p>',
  '<p>등기부등본 변동 감시부터 계약서 위험 조항 분석까지, AI가 알아서 챙겨드립니다.</p>',
  '<p>근저당·가압류·소유권 변경 — 모르는 사이 생기는 위험을 실시간으로 알려드립니다.</p>',
  '<p></p>',
  '<p>https://vestra-plum.vercel.app</p>',
  '<p></p>',
  // 태그는 tagList 필드로 전달 (본문 해시태그 제거)
].join('\n');

// ---------------------------------------------------------------------------
// 동적 태그 생성 — 콘텐츠 주제·키워드 기반
// ---------------------------------------------------------------------------
const BRAND_TAGS = ['VESTRA', '베스트라'];

/** 콘텐츠에서 H2 소제목 키워드 추출 */
function extractH2Keywords(text: string): string[] {
  const matches = text.match(/^##\s+(.+)$/gm) ?? [];
  return matches
    .map(m => m.replace(/^##\s+/, '').replace(/(?:🔍|📌|✅|💡|🏠|📊|⚠️|⚠|🔑|📋|💰|🏢|📈|🔎|✨|🎯)/gu, '').trim())
    .filter(h => h.length >= 2 && h.length <= 20 && !h.includes('목차'));
}

/** 주제·키워드·본문에서 네이버 카페 태그 자동 생성 (최대 10개) */
export function generateDynamicTags(subject: string, keywords: string[], content: string): string {
  const tagSet = new Set<string>();

  // 1) DB 키워드 (가장 관련성 높음)
  for (const kw of keywords) {
    const clean = kw.trim().replace(/\s+/g, '');
    if (clean.length >= 2 && clean.length <= 20) tagSet.add(clean);
  }

  // 2) 제목에서 핵심 단어 추출 (2글자 이상 명사 위주)
  const stopWords = new Set(['방법', '완벽', '가이드', '정리', '핵심', '확인', '분석', '총정리']);
  const subjectWords = subject
    .replace(/[0-9]{4}년|[0-9]+가지|[0-9]+월/g, '') // 연도·숫자 제거
    .split(/[\s,·|/]+/)
    .map(w => w.trim())
    .filter(w => w.length >= 2 && w.length <= 10 && !stopWords.has(w));
  for (const w of subjectWords) tagSet.add(w);

  // 3) H2 소제목에서 키워드 보충
  const h2Keywords = extractH2Keywords(content);
  for (const h2 of h2Keywords.slice(0, 3)) {
    const words = h2.split(/[\s,·]+/).filter(w => w.length >= 2 && w.length <= 10);
    for (const w of words) {
      if (tagSet.size >= 8) break;
      tagSet.add(w);
    }
  }

  // 4) 브랜드 태그 항상 포함
  for (const b of BRAND_TAGS) tagSet.add(b);

  // 최대 10개, 쉼표 구분
  return Array.from(tagSet).slice(0, 10).join(',');
}

