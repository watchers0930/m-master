// lib/publish/facebook.ts — Facebook Pages API 발행
//
// 페이지에 게시하는 표준 endpoint:
//   - 이미지 + 메시지: POST /{page-id}/photos  (url, message)
//   - 텍스트만:       POST /{page-id}/feed    (message)
//
// 환경변수:
//   FACEBOOK_ACCESS_TOKEN  — 페이지 액세스 토큰 (페이지 관리자 + pages_manage_posts 권한)
//   FACEBOOK_PAGE_ID       — 페이지 ID
//   META_GRAPH_VERSION     — 선택, 기본 'v20.0'

export interface FacebookPublishResult {
  id: string;          // 게시물 ID (page_id_post_id 형식일 수 있음)
  postId?: string;     // photos 응답의 추가 post_id
}

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) {
    throw new Error(`${name} 환경변수 미설정 — 페이스북 발행 불가`);
  }
  return v;
}

function getGraphVersion(): string {
  return process.env.META_GRAPH_VERSION || 'v20.0';
}

// 페북은 캡션 제한이 IG보다 훨씬 큼 (실질 63206자) — 마크다운 정리만
export function buildFacebookMessage(markdown: string): string {
  return markdown
    .replace(/^\[이미지:.*\]$/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^>\s+/gm, '')
    .replace(/^-\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function graphPost(path: string, body: Record<string, string>): Promise<unknown> {
  const url = `https://graph.facebook.com/${getGraphVersion()}/${path}`;
  const params = new URLSearchParams(body);
  const res = await fetch(url, {
    method: 'POST',
    body: params,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`Facebook Graph API 실패: ${msg}`);
  }
  return json;
}

/**
 * 페이지에 이미지+메시지 게시. imageUrl이 없으면 텍스트 피드로 게시.
 */
export async function publishFacebookPost(opts: {
  imageUrl: string | null;
  message: string;
}): Promise<FacebookPublishResult> {
  const token = getEnv('FACEBOOK_ACCESS_TOKEN');
  const pageId = getEnv('FACEBOOK_PAGE_ID');
  const message = buildFacebookMessage(opts.message);

  if (opts.imageUrl) {
    const res = (await graphPost(`${pageId}/photos`, {
      url: opts.imageUrl,
      message,
      access_token: token,
    })) as { id?: string; post_id?: string };

    if (!res.id) {
      throw new Error('Facebook 사진 게시 실패 — id 누락');
    }
    return { id: res.id, postId: res.post_id };
  }

  // 텍스트 피드
  const res = (await graphPost(`${pageId}/feed`, {
    message,
    access_token: token,
  })) as { id?: string };

  if (!res.id) {
    throw new Error('Facebook 피드 게시 실패 — id 누락');
  }
  return { id: res.id };
}
