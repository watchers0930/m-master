// lib/publish/naver-cafe.ts — 네이버 카페 API 발행
//
// 카페 게시글 작성 endpoint:
//   POST https://openapi.naver.com/v1/cafe/{clubid}/menu/{menuid}/articles
//
// 환경변수:
//   NAVER_CAFE_ACCESS_TOKEN   — OAuth 2.0 Bearer 토큰 (1시간 만료)
//   NAVER_CAFE_REFRESH_TOKEN  — 토큰 자동 갱신용
//   NAVER_CLIENT_ID           — 네이버 개발자센터 앱 Client ID
//   NAVER_CLIENT_SECRET       — 네이버 개발자센터 앱 Client Secret
//   NAVER_CAFE_CLUB_ID        — 카페 고유 ID
//   NAVER_CAFE_MENU_ID        — 게시판 메뉴 ID

import { getNaverCafeCreds } from '@/lib/channel-credentials';

export interface NaverCafePublishResult {
  articleId: string;
  cafeUrl: string;
}

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) {
    throw new Error(`${name} 환경변수 미설정 — 네이버 카페 발행 불가`);
  }
  return v;
}

/** DB 자격증명 resolve 결과 */
interface ResolvedNaverCreds {
  accessToken: string; refreshToken: string;
  clientId: string; clientSecret: string;
  clubId: string; menuId: string;
}

/** DB 우선 → 환경변수 fallback으로 자격증명 해석 */
async function resolveCredentials(): Promise<ResolvedNaverCreds> {
  const creds = await getNaverCafeCreds();
  if (creds) return creds;
  return {
    accessToken: getEnv('NAVER_CAFE_ACCESS_TOKEN'),
    refreshToken: process.env.NAVER_CAFE_REFRESH_TOKEN ?? '',
    clientId: process.env.NAVER_CLIENT_ID ?? '',
    clientSecret: process.env.NAVER_CLIENT_SECRET ?? '',
    clubId: getEnv('NAVER_CAFE_CLUB_ID'),
    menuId: getEnv('NAVER_CAFE_MENU_ID'),
  };
}

// ---------------------------------------------------------------------------
// 토큰 자동 갱신 (access_token 만료 시 refresh_token으로 재발급)
// ---------------------------------------------------------------------------
let cachedAccessToken: string | null = null;

async function refreshAccessToken(): Promise<string> {
  // DB 자격증명 우선, 없으면 env fallback
  const resolved = await resolveCredentials();
  const clientId = resolved.clientId || getEnv('NAVER_CLIENT_ID');
  const clientSecret = resolved.clientSecret || getEnv('NAVER_CLIENT_SECRET');
  const refreshToken = resolved.refreshToken || getEnv('NAVER_CAFE_REFRESH_TOKEN');

  const res = await fetch(
    `https://nid.naver.com/oauth2.0/token?${new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    })}`,
  );

  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!json.access_token) {
    throw new Error(`네이버 토큰 갱신 실패: ${json.error_description ?? json.error ?? 'unknown'}`);
  }

  cachedAccessToken = json.access_token;
  console.log('[naver-cafe] 토큰 자동 갱신 완료');
  return json.access_token;
}

async function getAccessToken(): Promise<string> {
  return cachedAccessToken ?? process.env.NAVER_CAFE_ACCESS_TOKEN ?? '';
}

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
        htmlParts.push(`<p><img src="${imgs[imgIdx]}" alt="" /></p>`);
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
      htmlParts.push(`<blockquote>${plain}</blockquote>`);
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
// 이미지 다운로드 (외부 URL → Buffer, 실패 시 스킵)
// ---------------------------------------------------------------------------
interface DownloadedImage {
  buffer: Buffer;
  name: string;
  type: string;
}

async function downloadImages(urls: string[]): Promise<DownloadedImage[]> {
  const results: DownloadedImage[] = [];
  for (let i = 0; i < urls.length; i++) {
    try {
      const url = urls[i];
      if (!url || url.trim() === '') continue;
      // 상대 경로 → 절대 경로
      const absUrl = url.startsWith('http') ? url : `${process.env.NEXT_PUBLIC_APP_URL ?? ''}${url}`;
      const res = await fetch(absUrl, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) continue;
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      if (buffer.length < 1000) continue; // 너무 작으면 스킵
      const contentType = res.headers.get('content-type') ?? 'image/jpeg';
      const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
      results.push({ buffer, name: `image${i}.${ext}`, type: contentType });
      console.log(`[naver-cafe] 이미지 다운로드 [${i}]: ${buffer.length} bytes`);
    } catch {
      console.warn(`[naver-cafe] 이미지 다운로드 실패 [${i}]: ${urls[i]}`);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// form body 구성 — 값 2중 인코딩 (네이버 API 한글 깨짐 방지)
// 네이버 카페 API는 서버 측에서 추가 URL 디코딩을 수행하므로
// 값을 2중 인코딩해야 한글이 정상 표시된다.
// (500/999 에러는 인코딩이 아닌 스팸 필터 원인으로 확인됨)
// ---------------------------------------------------------------------------
function buildFormBody(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(encodeURIComponent(v))}`)
    .join('&');
}

// ---------------------------------------------------------------------------
// 카페 API 호출 — urlencoded (텍스트 전용)
// ---------------------------------------------------------------------------
async function cafeApiPost(
  clubId: string,
  menuId: string,
  fields: Record<string, string>,
): Promise<{ res: Response; json: Record<string, unknown> }> {
  const url = `https://openapi.naver.com/v1/cafe/${clubId}/menu/${menuId}/articles`;
  const body = buildFormBody(fields);

  let token = await getAccessToken();
  let res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    },
    body,
  });

  // 401 → 토큰 만료 → 자동 갱신 후 재시도
  if (res.status === 401) {
    token = await refreshAccessToken();
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body,
    });
  }

  return handleCafeResponse(res);
}

// ---------------------------------------------------------------------------
// 카페 API 호출 — multipart (이미지 첨부)
// ---------------------------------------------------------------------------
async function cafeApiPostWithImages(
  clubId: string,
  menuId: string,
  fields: Record<string, string>,
  images: DownloadedImage[],
): Promise<{ res: Response; json: Record<string, unknown> }> {
  const url = `https://openapi.naver.com/v1/cafe/${clubId}/menu/${menuId}/articles`;

  function buildFormData(): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) {
      // 네이버 서버가 추가 URL 디코딩을 수행하므로 1중 인코딩 필요
      fd.append(k, encodeURIComponent(v));
    }
    for (let i = 0; i < images.length; i++) {
      fd.append('image', new Blob([new Uint8Array(images[i].buffer)], { type: images[i].type }), images[i].name);
    }
    return fd;
  }

  let token = await getAccessToken();
  let res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: buildFormData(),
  });

  if (res.status === 401) {
    token = await refreshAccessToken();
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: buildFormData(),
    });
  }

  return handleCafeResponse(res);
}

// ---------------------------------------------------------------------------
// 응답 처리 공통
// ---------------------------------------------------------------------------
async function handleCafeResponse(res: Response): Promise<{ res: Response; json: Record<string, unknown> }> {
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (
    res.status === 403 ||
    (json?.message as { error?: { code?: string } })?.error?.code === '999'
  ) {
    throw new Error('네이버 카페 스팸 방지 감지 — 발행 간격을 늘려주세요 (최소 10초)');
  }

  return { res, json };
}

// ---------------------------------------------------------------------------
// 카페 글 하단 고정 푸터 (VESTRA 소개 + 도메인 + 해시태그)
// ---------------------------------------------------------------------------
const CAFE_FOOTER = [
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
    .map(m => m.replace(/^##\s+/, '').replace(/[🔍📌✅💡🏠📊⚠️🔑📋💰🏢📈🔎✨🎯]/g, '').trim())
    .filter(h => h.length >= 2 && h.length <= 20 && !h.includes('목차'));
}

/** 주제·키워드·본문에서 네이버 카페 태그 자동 생성 (최대 10개) */
function generateDynamicTags(subject: string, keywords: string[], content: string): string {
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

// ---------------------------------------------------------------------------
// 게시글 발행
// ---------------------------------------------------------------------------
/**
 * 네이버 카페에 게시글 작성 (이미지 첨부 지원)
 */
export async function publishNaverCafePost(opts: {
  subject: string;
  content: string;
  keywords?: string[];
  imageUrls?: string[];
  imageUrl?: string;   // 썸네일 폴백 (bodyImageUrls가 비었을 때 사용)
  clubId?: string;   // 지정 시 이 카페로 발행
  menuId?: string;   // 지정 시 이 게시판으로 발행
}): Promise<NaverCafePublishResult> {
  const resolved = await resolveCredentials();
  const clubId = opts.clubId || resolved.clubId;
  const menuId = opts.menuId || resolved.menuId;
  // DB 자격증명이 있으면 cachedAccessToken에 반영
  if (resolved.accessToken) cachedAccessToken = resolved.accessToken;

  // 이미지 URL 준비 (bodyImage 우선, 없으면 썸네일 폴백)
  let imgUrls = (opts.imageUrls ?? []).filter(u => u && u.trim() !== '');
  if (imgUrls.length === 0 && opts.imageUrl) {
    imgUrls = [opts.imageUrl];
  }
  console.log(`[naver-cafe] 이미지 URL ${imgUrls.length}개 (원본 ${(opts.imageUrls ?? []).length}개)`);

  // 본문 HTML 생성 (인라인 <img>는 네이버 API가 거부 — multipart 첨부만 허용)
  const htmlBody = buildNaverCafeContent(opts.content, []) + '\n' + CAFE_FOOTER;
  const tags = generateDynamicTags(opts.subject, opts.keywords ?? [], opts.content);
  const fields = { subject: opts.subject, content: htmlBody, openyn: 'true', tagList: tags };

  // 이미지: 대표 1장만 multipart 첨부 (네이버 API가 본문 상단에 배치)
  const images = imgUrls.length > 0 ? await downloadImages(imgUrls.slice(0, 1)) : [];
  console.log(`[naver-cafe] 이미지 다운로드 결과: ${images.length}장`);

  const { res, json } = images.length > 0
    ? await cafeApiPostWithImages(clubId, menuId, fields, images)
    : await cafeApiPost(clubId, menuId, fields);

  if (!res.ok) {
    const msg = (json?.message as { error?: { msg?: string } })?.error?.msg ?? `HTTP ${res.status}`;
    throw new Error(`네이버 카페 API 실패: ${msg}`);
  }

  const result = (json?.message as { result?: { articleId?: number; cafeUrl?: string } })?.result;
  const articleId = result?.articleId;
  const cafeUrl = result?.cafeUrl ?? '';

  if (!articleId) {
    throw new Error('네이버 카페 게시 실패 — articleId 누락');
  }

  return {
    articleId: String(articleId),
    cafeUrl: cafeUrl || `https://cafe.naver.com/ca-fe/cafes/${clubId}/articles/${articleId}`,
  };
}
