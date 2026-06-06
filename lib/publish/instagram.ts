// lib/publish/instagram.ts — Instagram Graph API 발행
//
// 흐름 (Meta Graph API 표준 2단계):
//   1) POST /{ig-user-id}/media        -> 컨테이너 생성 (image_url + caption)
//   2) POST /{ig-user-id}/media_publish -> 컨테이너 게시 (creation_id)
//
// 환경변수:
//   INSTAGRAM_ACCESS_TOKEN  — 페이지 토큰 (장기 토큰 권장, 60일 갱신)
//   INSTAGRAM_BUSINESS_ID   — IG Business Account ID (Facebook Graph Explorer에서 확인)
//   META_GRAPH_VERSION      — 선택, 기본 'v20.0'
//
// 제약:
//   - 이미지 URL은 공개 접근 가능해야 함
//   - 캡션 2200자 제한 (긴 본문은 자동 축약)

import { getInstagramCreds } from '@/lib/channel-credentials';

export interface InstagramPublishResult {
  id: string; // media_publish 응답의 게시 ID
  permalink?: string;
}

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) {
    throw new Error(`${name} 환경변수 미설정 — 인스타 발행 불가`);
  }
  return v;
}

/** DB 우선 → 환경변수 fallback으로 자격증명 해석 */
async function resolveCredentials(ownerId?: string): Promise<{ token: string; igUserId: string }> {
  const creds = ownerId ? await getInstagramCreds(ownerId) : null;
  if (creds) return { token: creds.accessToken, igUserId: creds.businessId };
  return { token: getEnv('INSTAGRAM_ACCESS_TOKEN'), igUserId: getEnv('INSTAGRAM_BUSINESS_ID') };
}

function getGraphVersion(): string {
  return process.env.META_GRAPH_VERSION || 'v20.0';
}

const IG_CAPTION_MAX = 2200;

/**
 * 마크다운 본문을 IG 캡션용 plain text로 축약.
 * - 마크다운 기호 제거, [이미지: ...] 마커 제거
 * - 2200자 제한 (말줄임표로 잘림)
 */
export function buildInstagramCaption(markdown: string): string {
  let text = markdown
    .replace(/^\[이미지:.*\]$/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^>\s+/gm, '')
    .replace(/^-\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (text.length > IG_CAPTION_MAX) {
    text = text.slice(0, IG_CAPTION_MAX - 1).trimEnd() + '…';
  }
  return text;
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
    throw new Error(`Instagram Graph API 실패: ${msg}`);
  }
  return json;
}

/**
 * IG 캐러셀(여러 장) 게시 — 3단계:
 * 1) 각 이미지 URL로 child container 생성 (is_carousel_item=true)
 * 2) carousel container 생성 (media_type=CAROUSEL, children=[ids])
 * 3) media_publish 호출
 */
export async function publishInstagramCarousel(opts: {
  imageUrls: string[];
  caption: string;
  ownerId?: string;
}): Promise<InstagramPublishResult> {
  if (opts.imageUrls.length < 2) {
    throw new Error('캐러셀 발행에는 최소 2장의 이미지가 필요합니다');
  }

  const { token, igUserId } = await resolveCredentials(opts.ownerId);
  const caption = buildInstagramCaption(opts.caption);

  // 1단계: 각 이미지로 child container 생성
  const childIds: string[] = [];
  for (const imageUrl of opts.imageUrls) {
    const child = (await graphPost(`${igUserId}/media`, {
      image_url: imageUrl,
      is_carousel_item: 'true',
      access_token: token,
    })) as { id?: string };

    if (!child.id) {
      throw new Error('Instagram 캐러셀 child 컨테이너 생성 실패 — id 누락');
    }
    childIds.push(child.id);
  }

  // 2단계: carousel container 생성
  const carousel = (await graphPost(`${igUserId}/media`, {
    media_type: 'CAROUSEL',
    children: childIds.join(','),
    caption,
    access_token: token,
  })) as { id?: string };

  if (!carousel.id) {
    throw new Error('Instagram 캐러셀 컨테이너 생성 실패 — id 누락');
  }

  // 3단계: 게시
  const published = (await graphPost(`${igUserId}/media_publish`, {
    creation_id: carousel.id,
    access_token: token,
  })) as { id?: string };

  if (!published.id) {
    throw new Error('Instagram 캐러셀 게시 실패 — id 누락');
  }

  return { id: published.id };
}

/**
 * IG 단일 이미지 게시.
 * caption은 markdown을 그대로 받아도 buildInstagramCaption으로 변환됨.
 */
export async function publishInstagramImage(opts: {
  imageUrl: string;
  caption: string;
  ownerId?: string;
}): Promise<InstagramPublishResult> {
  const { token, igUserId } = await resolveCredentials(opts.ownerId);
  const caption = buildInstagramCaption(opts.caption);

  // 1단계: 컨테이너 생성
  const container = (await graphPost(`${igUserId}/media`, {
    image_url: opts.imageUrl,
    caption,
    access_token: token,
  })) as { id?: string };

  if (!container.id) {
    throw new Error('Instagram 컨테이너 생성 실패 — id 누락');
  }

  // 2단계: 게시
  const published = (await graphPost(`${igUserId}/media_publish`, {
    creation_id: container.id,
    access_token: token,
  })) as { id?: string };

  if (!published.id) {
    throw new Error('Instagram 게시 실패 — id 누락');
  }

  return { id: published.id };
}
