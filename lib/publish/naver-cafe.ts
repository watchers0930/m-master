import { ChannelRejection, loadCredentials } from './errors';
import { CAFE_FOOTER, generateDynamicTags, buildNaverCafeContent } from './naver-cafe-content';
export { buildNaverCafeContent } from './naver-cafe-content';
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

/** DB 자격증명 resolve 결과 */
interface ResolvedNaverCreds {
  accessToken: string; refreshToken: string;
  clientId: string; clientSecret: string;
  clubId: string; menuId: string;
}

/** SaaS: getNaverCafeCreds 단일 소스 — 자체 env fallback 제거 (credential 격리) */
async function resolveCredentials(ownerId: string): Promise<ResolvedNaverCreds> {
  const creds = await loadCredentials(() => getNaverCafeCreds(ownerId), 'naver_cafe');
  if (!creds) {
    throw new ChannelRejection();
  }
  return creds;
}

// ---------------------------------------------------------------------------
// 토큰 자동 갱신 (access_token 만료 시 refresh_token으로 재발급)
// SaaS: 모듈 레벨 캐시 제거 — 유저별 토큰 격리
// ---------------------------------------------------------------------------
async function refreshAccessToken(creds: ResolvedNaverCreds): Promise<string> {
  if (!creds.clientId || !creds.clientSecret || !creds.refreshToken) {
    throw new Error('네이버 토큰 갱신 불가 — clientId/clientSecret/refreshToken 필요');
  }

  const res = await fetch(
    `https://nid.naver.com/oauth2.0/token?${new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
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

  console.log('[naver-cafe] 토큰 자동 갱신 완료');
  return json.access_token;
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
  creds: ResolvedNaverCreds,
): Promise<{ res: Response; json: Record<string, unknown> }> {
  const url = `https://openapi.naver.com/v1/cafe/${clubId}/menu/${menuId}/articles`;
  const body = buildFormBody(fields);

  let token = creds.accessToken;
  let res = await fetch(url, {
    method: 'POST', signal: AbortSignal.timeout(20000),
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    },
    body,
  });

  // 401 → 토큰 만료 → 해당 유저의 credential로 갱신 후 재시도
  if (res.status === 401) {
    token = await refreshAccessToken(creds);
    res = await fetch(url, {
      method: 'POST', signal: AbortSignal.timeout(20000),
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
  creds: ResolvedNaverCreds,
): Promise<{ res: Response; json: Record<string, unknown> }> {
  const url = `https://openapi.naver.com/v1/cafe/${clubId}/menu/${menuId}/articles`;

  function buildFormData(): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) {
      fd.append(k, encodeURIComponent(v));
    }
    for (let i = 0; i < images.length; i++) {
      fd.append('image', new Blob([new Uint8Array(images[i].buffer)], { type: images[i].type }), images[i].name);
    }
    return fd;
  }

  let token = creds.accessToken;
  let res = await fetch(url, {
    method: 'POST', signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${token}` },
    body: buildFormData(),
  });

  if (res.status === 401) {
    token = await refreshAccessToken(creds);
    res = await fetch(url, {
      method: 'POST', signal: AbortSignal.timeout(20000),
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
  ownerId: string;   // SaaS 필수: DB 자격증명 조회용
}): Promise<NaverCafePublishResult> {
  const resolved = await resolveCredentials(opts.ownerId);
  const clubId = opts.clubId || resolved.clubId;
  const menuId = opts.menuId || resolved.menuId;

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
    ? await cafeApiPostWithImages(clubId, menuId, fields, images, resolved)
    : await cafeApiPost(clubId, menuId, fields, resolved);

  if (!res.ok) {
    const msg = (json?.message as { error?: { msg?: string } })?.error?.msg ?? `HTTP ${res.status}`;
    if (res.status >= 400 && res.status < 500) throw new ChannelRejection();
    throw new Error('channel_response_error');
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
