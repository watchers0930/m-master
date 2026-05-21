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

// ---------------------------------------------------------------------------
// 토큰 자동 갱신 (access_token 만료 시 refresh_token으로 재발급)
// ---------------------------------------------------------------------------
let cachedAccessToken: string | null = null;

async function refreshAccessToken(): Promise<string> {
  const clientId = getEnv('NAVER_CLIENT_ID');
  const clientSecret = getEnv('NAVER_CLIENT_SECRET');
  const refreshToken = getEnv('NAVER_CAFE_REFRESH_TOKEN');

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
// 마크다운 → HTML 변환
// ---------------------------------------------------------------------------
/** 마크다운 → HTML 변환 (카페 API는 HTML 본문 지원) */
export function buildNaverCafeContent(markdown: string): string {
  return markdown
    .replace(/^\[이미지:.*\]$/gm, '')
    .replace(/^#{1,6}\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^-\s+(.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)
    .replace(/\n{2,}/g, '<br><br>')
    .replace(/\n/g, '<br>')
    .trim();
}

// ---------------------------------------------------------------------------
// 카페 API 호출 (401 시 토큰 갱신 후 1회 재시도)
// ---------------------------------------------------------------------------
async function cafeApiPost(
  clubId: string,
  menuId: string,
  params: URLSearchParams,
): Promise<{ res: Response; json: Record<string, unknown> }> {
  const url = `https://openapi.naver.com/v1/cafe/${clubId}/menu/${menuId}/articles`;

  let token = await getAccessToken();
  let res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });

  // 401 → 토큰 만료 → 자동 갱신 후 재시도
  if (res.status === 401) {
    token = await refreshAccessToken();
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });
  }

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { res, json };
}

// ---------------------------------------------------------------------------
// 게시글 발행
// ---------------------------------------------------------------------------
/**
 * 네이버 카페에 게시글 작성
 */
export async function publishNaverCafePost(opts: {
  subject: string;
  content: string;
}): Promise<NaverCafePublishResult> {
  const clubId = getEnv('NAVER_CAFE_CLUB_ID');
  const menuId = getEnv('NAVER_CAFE_MENU_ID');

  const body = buildNaverCafeContent(opts.content);

  const { res, json } = await cafeApiPost(
    clubId,
    menuId,
    new URLSearchParams({ subject: opts.subject, content: body }),
  );

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
