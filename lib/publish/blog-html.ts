// lib/publish/blog-html.ts — 블로그 HTML export 생성
// plan.md S4.4: blog_{YYYYMMDD}_{slug}.html, og/meta/thumbnail 포함, UTF-8

import { prisma } from '@/lib/prisma';

// ----------------------------------------------------------------
// slug 생성 (한글 포함 topic -> URL 안전 slug)
// ----------------------------------------------------------------
function toSlug(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^\w가-힣\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60);
}

// ----------------------------------------------------------------
// YYYYMMDD 날짜 문자열
// ----------------------------------------------------------------
function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

// ----------------------------------------------------------------
// HTML 이스케이프
// ----------------------------------------------------------------
function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ----------------------------------------------------------------
// 본문 텍스트 -> HTML 단락 변환 (본문 내 [이미지: 설명] 마커를 <figure><img>로 치환)
// ----------------------------------------------------------------
function textToHtml(text: string, bodyImageUrls: string[] = []): string {
  let imgIdx = 0;
  return text
    .split(/\n{2,}/)
    .map((para) => {
      const trimmed = para.trim();
      // 단락이 [이미지: 설명] 패턴이면 figure로 치환
      const imgMatch = trimmed.match(/^\[이미지:\s*(.+?)\]\s*$/);
      if (imgMatch) {
        const desc = imgMatch[1];
        const url = bodyImageUrls[imgIdx++];
        if (url) {
          return `<figure><img src="${escHtml(url)}" alt="${escHtml(desc)}" style="max-width:100%;height:auto;border-radius:8px;display:block;margin:0 auto;"><figcaption style="font-size:0.85em;color:#666;text-align:center;font-style:italic;margin-top:0.3em;">${escHtml(desc)}</figcaption></figure>`;
        }
        // URL 없으면 주석 처리 (HTML 외부 노출 X)
        return `<!-- [이미지: ${escHtml(desc)}] -->`;
      }
      return `<p>${escHtml(trimmed).replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');
}

export interface BlogHtmlResult {
  html: string;
  filename: string;
}

export async function generateBlogHtml(contentId: string): Promise<BlogHtmlResult> {
  // contents 조회
  const content = await prisma.content.findUnique({
    where: { id: contentId },
    select: {
      id: true,
      topic: true,
      textBody: true,
      imageUrl: true,
      bodyImageUrls: true,
      keywords: true,
      channel: true,
      createdAt: true,
    },
  });

  if (!content || content.channel !== 'blog') {
    throw new Error(`content 조회 실패: id=${contentId}, channel=blog`);
  }

  const now = new Date();
  const dateStr = formatDate(now);
  const slug = toSlug(content.topic);
  const filename = `blog_${dateStr}_${slug}.html`;

  const title = escHtml(content.topic);
  const description = escHtml((content.textBody ?? '').slice(0, 160));
  const keywords = ((content.keywords as string[]) ?? []).map(escHtml).join(', ');
  const imageUrl = content.imageUrl ?? '';
  const bodyHtml = textToHtml(
    content.textBody ?? '',
    (content.bodyImageUrls as string[]) ?? [],
  );

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <meta name="keywords" content="${keywords}">
  <meta name="robots" content="index, follow">

  <!-- Open Graph -->
  <meta property="og:type" content="article">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:image" content="${escHtml(imageUrl)}">
  <meta property="og:locale" content="ko_KR">
  <meta property="og:site_name" content="VESTRA">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${escHtml(imageUrl)}">

  <style>
    body { font-family: 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; color: #222; line-height: 1.8; }
    h1 { font-size: 2rem; font-weight: 700; margin-bottom: 1.5rem; }
    .thumbnail { width: 100%; max-height: 450px; object-fit: cover; border-radius: 8px; margin-bottom: 2rem; }
    p { margin-bottom: 1.2rem; }
  </style>
</head>
<body>
  <article>
    <h1>${title}</h1>
    ${imageUrl ? `<img class="thumbnail" src="${escHtml(imageUrl)}" alt="${title}">` : ''}
    <div class="body">
${bodyHtml}
    </div>
  </article>
</body>
</html>`;

  return { html, filename };
}
