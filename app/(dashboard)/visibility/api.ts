// app/(dashboard)/visibility/api.ts
// AI 가시성 기능 전용 API 래퍼 (프론트 → /api/visibility, /api/domains).
// 설계 §3 계약을 그대로 호출만 한다. 알고리즘/검증은 서버(lib/·app/api/) 책임.
// envelope 규약: 성공 { data: T } / 실패 { error: { code, message } } (설계 §3 공통 규약).

import type {
  VisibilityDataResponse,
  VisibilityQueryDTO,
  DomainDTO,
  EngineId,
  Market,
  Frequency,
  SnapshotStatus,
} from '@/types/visibility';

/** 서버 에러 code 를 보존해 UI 분기(플랜/한도/간격 등)에 사용 */
export class VisibilityApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'VisibilityApiError';
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
    /* 본문 없음/비JSON — 아래에서 status 로 처리 */
  }
  const body = (json ?? {}) as { data?: T; error?: { code?: string; message?: string } };
  if (!res.ok || body.error) {
    const code = body.error?.code ?? 'unknown';
    const message = body.error?.message ?? `요청 실패 (HTTP ${res.status})`;
    throw new VisibilityApiError(res.status, code, message);
  }
  return body.data as T;
}

function jsonInit(method: string, payload: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

// ── 집계 데이터 (GET /api/visibility/data) ────────────────────────
export interface VisibilityDataFilters {
  citationLimit?: number;
  citationCursor?: string;
  market: Market;
  from?: string; // ISO date (YYYY-MM-DD)
  to?: string;
  queryId?: string | null;
  domainId?: string | null;
  engine?: EngineId | null;
}

export async function fetchVisibilityData(
  f: VisibilityDataFilters,
): Promise<VisibilityDataResponse> {
  const qs = new URLSearchParams({ market: f.market });
  if (f.from) qs.set('from', f.from);
  if (f.to) qs.set('to', f.to);
  if (f.queryId) qs.set('queryId', f.queryId);
  if (f.domainId) qs.set('domainId', f.domainId);
  if (f.engine) qs.set('engine', f.engine);
  if (f.citationLimit) qs.set('citationLimit', String(f.citationLimit));
  if (f.citationCursor) qs.set('citationCursor', f.citationCursor);
  return request<VisibilityDataResponse>(`/api/visibility/data?${qs.toString()}`);
}

// ── 질문 목록 (GET /api/visibility/queries) ───────────────────────
export interface ListQueriesParams {
  active?: boolean;
  domainId?: string;
  market?: Market;
  limit?: number;
  cursor?: string;
}

export async function listVisibilityQueries(p: ListQueriesParams = {}): Promise<{ data: VisibilityQueryDTO[]; nextCursor: string | null }> {
  const qs = new URLSearchParams();
  if (p.active !== undefined) qs.set('active', String(p.active));
  if (p.domainId) qs.set('domainId', p.domainId);
  if (p.market) qs.set('market', p.market);
  if (p.limit) qs.set('limit', String(p.limit));
  if (p.cursor) qs.set('cursor', p.cursor);
  const res = await fetch(`/api/visibility/queries?${qs}`);
  if (!res.ok) {
    const body = await res.json();
    throw new VisibilityApiError(res.status, body.error?.code ?? 'unknown', body.error?.message ?? '조회 실패');
  }
  return res.json();
}

// ── 질문 생성 (POST /api/visibility/queries) ──────────────────────
export interface CreateQueryBody {
  query: string;
  domainId?: string | null;
  market?: Market;
  engines?: EngineId[];
  brandAliases: string[];
  competitorAliases?: string[];
  frequency?: Frequency;
  active?: boolean;
}

export async function createVisibilityQuery(
  body: CreateQueryBody,
): Promise<VisibilityQueryDTO> {
  return request<VisibilityQueryDTO>('/api/visibility/queries', jsonInit('POST', body));
}

// ── 질문 수정 (PATCH /api/visibility/queries/[id]) ────────────────
export type UpdateQueryBody = Partial<CreateQueryBody>;

export async function updateVisibilityQuery(
  id: string,
  body: UpdateQueryBody,
): Promise<VisibilityQueryDTO> {
  return request<VisibilityQueryDTO>(
    `/api/visibility/queries/${id}`,
    jsonInit('PATCH', body),
  );
}

// ── 질문 삭제 (DELETE /api/visibility/queries/[id]) ───────────────
export async function deleteVisibilityQuery(
  id: string,
): Promise<{ id: string; deleted: true }> {
  return request<{ id: string; deleted: true }>(`/api/visibility/queries/${id}`, {
    method: 'DELETE',
  });
}

// ── 즉시 캡처 (POST /api/visibility/snapshot) ─────────────────────
export interface SnapshotResultItem {
  engine: EngineId;
  status: SnapshotStatus;
  snapshotId?: string;
  failReason?: string;
}

export async function captureSnapshot(
  queryId: string,
  engines?: EngineId[],
): Promise<{ results: SnapshotResultItem[] }> {
  const payload: { queryId: string; engines?: EngineId[] } = { queryId };
  if (engines && engines.length) payload.engines = engines;
  return request<{ results: SnapshotResultItem[] }>(
    '/api/visibility/snapshot',
    jsonInit('POST', payload),
  );
}

// ── 도메인 (GET·POST /api/domains) ────────────────────────────────
export async function listDomains(limit = 100): Promise<DomainDTO[]> {
  return request<DomainDTO[]>(`/api/domains?limit=${limit}`);
}

export interface CreateDomainBody {
  url: string;
  market?: Market;
  businessType?: string;
}

export async function createDomain(body: CreateDomainBody): Promise<DomainDTO> {
  return request<DomainDTO>('/api/domains', jsonInit('POST', body));
}
