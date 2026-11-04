// lib/api/content.ts — 콘텐츠 클라이언트 API 래퍼 단일 출처 (설계 §2.2·§4.1~§4.4).
// 상태전이·CAS·발행 판정·소유권은 전부 서버 책임. 이 파일은 fetch + envelope 해석만 한다.
// envelope: 성공 { data: T, error: null } / 실패 { error: { code, message } } (설계 §4.0).
// 실패는 ContentApiError(HTTP status·error.code 보존)로 던져 409 분기를 호출부가 일관되게 처리한다.
// 쓰기 요청은 브라우저 fetch 가 Origin 을 자동 첨부한다(서버 requireOrigin, 설계 §4.0).

import type { ContentListResponse } from '@/types/api';
import type {
  ContentDetail, ContentPatchBody, ConvertChannel, PublishChannel,
  ReviewBody, ReviewListQuery, ReviewResult,
} from '@/types/content-review';

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

// ── 목록 (GET /api/content) — 발행·검토 필터 + 페이지 ─────────────────
export async function listContents(q: ReviewListQuery = {}): Promise<ContentListResponse> {
  const qs = new URLSearchParams();
  if (q.status) qs.set('status', q.status);
  if (q.channel) qs.set('channel', q.channel);
  if (q.review_status) qs.set('review_status', q.review_status);
  if (q.origin) qs.set('origin', q.origin);
  if (q.page) qs.set('page', String(q.page));
  if (q.per_page) qs.set('per_page', String(q.per_page));
  return request<ContentListResponse>(`${BASE}?${qs}`);
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

// ── 토픽 기반 키워드 추천 (로컬 규칙 — 서버 호출 없음) ───────────────
export async function generateKeywords(topic: string): Promise<{ data: string[]; error: null }> {
  await new Promise((r) => setTimeout(r, 600));

  const domainMap: [RegExp, string[]][] = [
    [/매매|소유권|이전/, ['소유권이전등기', '부동산매매', '취득세', '등기비용', '잔금']],
    [/법인|설립|회사/, ['법인설립등기', '법인설립비용', '상업등기', '자본금', '정관']],
    [/근저당|담보|저당/, ['근저당설정등기', '담보대출', '채권최고액', '저당권', '금융기관']],
    [/상속|증여|유산/, ['상속등기', '증여등기', '상속세', '취득세면제', '법정상속']],
    [/전세|임대|보증/, ['전세권설정등기', '임차권등기', '보증금반환', '전세사기예방', '확정일자']],
    [/건물|빌딩|상가/, ['건물등기', '집합건물', '상가분양', '건축물대장', '구분소유권']],
    [/토지|대지|임야/, ['토지등기', '지목변경', '농지취득', '토지거래허가', '공시지가']],
  ];

  const keywords = new Set<string>();

  topic.split(/[\s,·]+/).filter(w => w.length >= 2).forEach(w => keywords.add(w));

  for (const [pattern, related] of domainMap) {
    if (pattern.test(topic)) {
      related.forEach(k => keywords.add(k));
      break;
    }
  }

  ['부동산', 'AI권리분석', '시세분석', '부동산안전', 'VESTRA'].forEach(k => keywords.add(k));

  return { data: Array.from(keywords).slice(0, 12), error: null };
}
