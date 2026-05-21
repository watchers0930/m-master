// lib/api/ab-test.ts — A/B 테스트 클라이언트 API 래퍼
import type {
  AbTestCreateRequest,
  AbTestCreateResponse,
  AbTestListQuery,
  AbTestListResponse,
  AbTestDetail,
  AbTestPatch,
  AbTestGa4Response,
  ApiResponse,
} from '@/types/api';
import type { AbTest } from '@/types/db';

const BASE = '/api/ab-test';

// ApiResult: lib/api/content.ts 패턴과 동일 형식
export type ApiResult<T> =
  | { data: T; error?: undefined }
  | { error: { code: string; message: string }; data?: undefined };

function toResult<T>(res: ApiResponse<T>): ApiResult<T> {
  if (res.error) return { error: { code: res.error.code, message: res.error.message } };
  return { data: res.data as T };
}

// ── 변형 쌍 생성 (POST /api/ab-test) ────────────────────────────────
export async function createAbTest(
  req: AbTestCreateRequest,
): Promise<ApiResult<AbTestCreateResponse>> {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  const json: ApiResponse<AbTestCreateResponse> = await res.json();
  return toResult(json);
}

// ── 목록 조회 (GET /api/ab-test) ────────────────────────────────────
export async function listAbTests(
  query: AbTestListQuery = {},
): Promise<ApiResult<AbTestListResponse>> {
  const qs = new URLSearchParams();
  if (query.status)             qs.set('status',  query.status);
  if (query.channel)            qs.set('channel', query.channel);
  if (query.from)               qs.set('from',    query.from);
  if (query.to)                 qs.set('to',      query.to);
  if (query.limit !== undefined) qs.set('limit',   String(query.limit));
  if (query.offset !== undefined) qs.set('offset', String(query.offset));

  const res = await fetch(`${BASE}?${qs}`);
  const json: ApiResponse<AbTestListResponse> = await res.json();
  return toResult(json);
}

// ── 단건 조회 (GET /api/ab-test/[id]) ───────────────────────────────
export async function getAbTest(id: string): Promise<ApiResult<AbTestDetail>> {
  const res = await fetch(`${BASE}/${id}`);
  const json: ApiResponse<AbTestDetail> = await res.json();
  return toResult(json);
}

// ── 부분 갱신 (PATCH /api/ab-test/[id]) ─────────────────────────────
export async function updateAbTest(
  id: string,
  patch: AbTestPatch,
): Promise<ApiResult<AbTest>> {
  const res = await fetch(`${BASE}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const json: ApiResponse<AbTest> = await res.json();
  return toResult(json);
}

// ── 삭제 (DELETE /api/ab-test/[id]) ─────────────────────────────────
export async function deleteAbTest(id: string): Promise<ApiResult<{ id: string }>> {
  const res = await fetch(`${BASE}/${id}`, { method: 'DELETE' });
  const json: ApiResponse<{ id: string }> = await res.json();
  return toResult(json);
}

// ── GA4 메트릭 조회 (GET /api/ab-test/[id]/ga4) ──────────────────────
export async function getAbTestGa4(id: string): Promise<ApiResult<AbTestGa4Response>> {
  const res = await fetch(`${BASE}/${id}/ga4`);
  const json: ApiResponse<AbTestGa4Response> = await res.json();
  return toResult(json);
}
