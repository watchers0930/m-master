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
// HTML 이스케이프 (마크다운 변환 전 원문에 적용)
// ---------------------------------------------------------------------------
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// 마크다운 → HTML 변환
// ---------------------------------------------------------------------------
/** 마크다운 → HTML 변환 (카페 API는 HTML 본문 지원) */
export function buildNaverCafeContent(markdown: string): string {
  // 1) 원문 HTML 이스케이프 (마크다운 기호 제외한 사용자 텍스트 보호)
  const escaped = escapeHtml(markdown);
  // 2) 마크다운 → HTML 태그 변환 (이스케이프된 텍스트 기반)
  return escaped
    .replace(/^\[이미지:.*\]$/gm, '')
    .replace(/^#{1,6}\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/^&gt;\s+(.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^-\s+(.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)
    .replace(/\n{2,}/g, '<br><br>')
    .replace(/\n/g, '<br>')
    .trim();
}

// ---------------------------------------------------------------------------
// 더블인코딩 body 구성
// URLSearchParams는 내부적으로 공백을 '+'로 인코딩하는데, 네이버 서버가
// 이를 올바르게 디코딩하지 못해 한글이 깨질 수 있다.
// encodeURIComponent를 2회 적용하면 네이버 서버가 1차 디코딩 후에도
// percent-encoded 상태가 유지되어, 최종 렌더링 시 정상 한글이 표시된다.
// ---------------------------------------------------------------------------
function buildFormBody(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(encodeURIComponent(v))}`)
    .join('&');
}

// ---------------------------------------------------------------------------
// 카페 API 호출 (401 시 토큰 갱신 후 1회 재시도)
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

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  // 403 + code:999 → 네이버 카페 스팸 방지 감지
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
    { subject: opts.subject, content: body },
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
