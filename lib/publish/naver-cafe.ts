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

    // 빈 줄 → 목록 종료 + 문단 간격
    if (line.trim() === '') {
      flushList();
      htmlParts.push('<br>');
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

    // 헤딩
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      flushList();
      htmlParts.push(`<h2>${inlineMd(h2Match[1])}</h2>`);
      continue;
    }
    const h3Match = line.match(/^###\s+(.+)$/);
    if (h3Match) {
      flushList();
      htmlParts.push(`<h3>${inlineMd(h3Match[1])}</h3>`);
      continue;
    }
    const h1Match = line.match(/^#\s+(.+)$/);
    if (h1Match) {
      flushList();
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

/** 인라인 마크다운 변환 (볼드, 이탤릭) */
function inlineMd(text: string): string {
  return text
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
      fd.append(`image[${i}]`, new Blob([new Uint8Array(images[i].buffer)], { type: images[i].type }), images[i].name);
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
  '<p>#부동산 #권리분석 #등기부등본 #전세사기방지 #아파트시세 #실거래가 #전세보증보험 #부동산세금 #VESTRA #베스트라</p>',
].join('\n');

// ---------------------------------------------------------------------------
// 게시글 발행
// ---------------------------------------------------------------------------
/**
 * 네이버 카페에 게시글 작성 (이미지 첨부 지원)
 */
export async function publishNaverCafePost(opts: {
  subject: string;
  content: string;
  imageUrls?: string[];
}): Promise<NaverCafePublishResult> {
  const resolved = await resolveCredentials();
  const clubId = resolved.clubId;
  const menuId = resolved.menuId;
  // DB 자격증명이 있으면 cachedAccessToken에 반영
  if (resolved.accessToken) cachedAccessToken = resolved.accessToken;

  // 본문 HTML 생성 (이미지 없이 텍스트만 발행)
  const htmlBody = buildNaverCafeContent(opts.content, []) + '\n' + CAFE_FOOTER;
  const fields = { subject: opts.subject, content: htmlBody };

  const { res, json } = await cafeApiPost(clubId, menuId, fields);

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
