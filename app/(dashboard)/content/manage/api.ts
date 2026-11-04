// app/(dashboard)/content/manage/api.ts
// 콘텐츠 관리 화면 전용 API 래퍼 (설계 §4.1~§4.4 계약을 그대로 호출만 한다).
// 상태전이·CAS·발행 판정·소유권은 전부 서버 책임. 이 파일은 fetch + envelope 해석만 한다.
// envelope: 성공 { data: T, error: null } / 실패 { error: { code, message } } (설계 §4.0).
// 쓰기 요청은 브라우저 fetch 가 Origin 을 자동 첨부한다(서버 requireOrigin, 설계 §4.0).

import type {
  ContentDetail, ContentPatchBody, ConvertChannel, PublishChannel,
  ReviewBody, ReviewListQuery, ReviewListResponse, ReviewResult,
} from './types';

const BASE = '/api/content';

/** 서버 error.code 를 보존해 409 분기(version_conflict·publish_in_progress 등)에 사용 */
export class ContentApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ContentApiError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* 본문 없음/비JSON — status 로 처리 */
  }
  const body = (json ?? {}) as { data?: T; error?: { code?: string; message?: string } | string | null };
  if (!res.ok || body.error) {
    const err = typeof body.error === 'object' && body.error ? body.error : null;
    const code = err?.code ?? 'unknown';
    const message = err?.message ?? (typeof body.error === 'string' ? body.error : `요청 실패 (HTTP ${res.status})`);
    throw new ContentApiError(res.status, code, message);
  }
  return body.data as T;
}

function jsonInit(method: string, payload: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
}

// ── 목록 (GET /api/content) — 검토 필터 포함 ─────────────────────────
export async function listReviewContents(q: ReviewListQuery): Promise<ReviewListResponse> {
  const qs = new URLSearchParams();
  if (q.status) qs.set('status', q.status);
  if (q.channel) qs.set('channel', q.channel);
  if (q.review_status) qs.set('review_status', q.review_status);
  if (q.origin) qs.set('origin', q.origin);
  if (q.page) qs.set('page', String(q.page));
  if (q.per_page) qs.set('per_page', String(q.per_page));
  return request<ReviewListResponse>(`${BASE}?${qs}`);
}

// ── 상세 (GET /api/content/[id]) ─────────────────────────────────────
export async function getContentDetail(id: string): Promise<ContentDetail> {
  return request<ContentDetail>(`${BASE}/${encodeURIComponent(id)}`);
}

// ── 수정 (PATCH /api/content/[id]) — expected_updated_at CAS ─────────
export async function updateContent(id: string, body: ContentPatchBody): Promise<ContentDetail> {
  return request<ContentDetail>(`${BASE}/${encodeURIComponent(id)}`, jsonInit('PATCH', body));
}

// ── 검토 상태전이 (POST /api/content/[id]/review) ────────────────────
export async function reviewContent(id: string, body: ReviewBody): Promise<ReviewResult> {
  return request<ReviewResult>(`${BASE}/${encodeURIComponent(id)}/review`, jsonInit('POST', body));
}

// ── 수동 발행 (POST /api/publish/{naver-cafe|facebook|instagram}) ────
// 요청 스키마는 기존 유지(content_id). 대상 타입은 서버가 content 로 고정한다(설계 §4.4).
const PUBLISH_PATH: Record<PublishChannel, string> = {
  naver_cafe: 'naver-cafe',
  facebook: 'facebook',
  instagram: 'instagram',
};

export interface PublishResult {
  url?: string;
  download_url?: string;
  /** 다중 카페 발행 결과 (기존 계약: 200 + error.code=partial_failure 이면 일부 실패) */
  results?: { name: string; url?: string; error?: string }[];
  partial?: boolean;
}

export async function publishContent(channel: PublishChannel, contentId: string): Promise<PublishResult> {
  const res = await fetch(`/api/publish/${PUBLISH_PATH[channel]}`, jsonInit('POST', { content_id: contentId }));
  const j = await res.json().catch(() => null) as { data?: PublishResult; error?: { code?: string; message?: string } | null } | null;
  // 200 + partial_failure 는 일부 게시 성공 — 실패로 던지면 성공분을 '실패'로 오안내한다
  if (res.ok && j?.data && j.error?.code === 'partial_failure') return { ...j.data, partial: true };
  if (!res.ok || !j?.data || j.error) {
    throw new ContentApiError(res.status, j?.error?.code ?? 'unknown', j?.error?.message ?? `요청 실패 (HTTP ${res.status})`);
  }
  return j.data;
}

// ── 채널 변환 (POST /api/content/[id]/convert) — 기존 계약 ───────────
export async function convertContent(id: string, channel: ConvertChannel): Promise<{ id?: string }> {
  return request<{ id?: string }>(`${BASE}/${encodeURIComponent(id)}/convert`, jsonInit('POST', { channel }));
}
