// app/(dashboard)/seo-audit/api.ts
// SEO 진단 기능 전용 API 래퍼 (프론트 → /api/seo, /api/domains).
// 설계 §6 계약을 그대로 호출만 한다. 알고리즘/검증/소유권은 서버(lib/·app/api/) 책임.
// envelope 규약: 성공 { data: T } / 실패 { error: { code, message } } (설계 §6 공통 규약).
// 경로·메서드·요청/응답 형태는 설계 §6 을 정확히 따른다. runKey(UUID)는 호출부에서 생성해 전달.

import type { DomainDTO, Market } from '@/types/visibility';
import type { SeoAuditDTO, SeoKeywordDTO, SeoRankingDTO, SeoEngine, AuditMode, Paginated } from '@/types/seo';

/** 서버 에러 code 를 보존해 UI 분기(플랜/한도/충돌/예산 등)에 사용 */
export class SeoApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'SeoApiError';
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
    throw new SeoApiError(res.status, code, message);
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

// ── 신규 진단 / 동일 키 재요청 (POST /api/seo/audit) ───────────────
// 200=완료·재사용 / 202=pending. request() 는 res.ok(2xx) 를 모두 통과시키므로
// 두 경우 모두 SeoAuditDTO 를 반환한다(상태는 DTO.status 로 구분).
export interface RunAuditBody {
  domainId: string; // 소유 Domain cuid
  runKey: string; // 클라이언트 생성 UUID
  mode?: AuditMode; // 기술감사 모드(crawl 페이지수는 서버 정책)
  paths?: string[]; // 선택, 1~5개, '/'로 시작
  engines?: SeoEngine[]; // 선택, 1~2개, 중복 금지(naver는 ko-KR만)
  keywordIds?: string[]; // 선택, ≤10개, 해당 Domain·market 소속
}

export async function runAudit(body: RunAuditBody): Promise<SeoAuditDTO> {
  return request<SeoAuditDTO>('/api/seo/audit', jsonInit('POST', body));
}

// ── 상세/이력 조회 (GET /api/seo/audit) — 무과금 ──────────────────
export interface ListAuditParams {
  domainId: string;
  auditId?: string; // 지정 시 상세(단건)
  cursor?: string;
  limit?: number; // 기본 50·최대 100
}

/** auditId 지정 → 단건 상세 (checks·coverage 포함) */
export async function fetchAuditDetail(domainId: string, auditId: string): Promise<SeoAuditDTO> {
  const qs = new URLSearchParams({ domainId, auditId });
  return request<SeoAuditDTO>(`/api/seo/audit?${qs.toString()}`);
}

/** auditId 미지정 → 이력 목록(keyset) */
export async function listAudits(p: ListAuditParams): Promise<Paginated<SeoAuditDTO>> {
  const qs = new URLSearchParams({ domainId: p.domainId });
  if (p.cursor) qs.set('cursor', p.cursor);
  if (p.limit) qs.set('limit', String(p.limit));
  return request<Paginated<SeoAuditDTO>>(`/api/seo/audit?${qs.toString()}`);
}

// ── 기존 실행 재개 (POST /api/seo/audit/[id]/resume) — 과금 가능 ───
export async function resumeAudit(auditId: string): Promise<SeoAuditDTO> {
  return request<SeoAuditDTO>(`/api/seo/audit/${auditId}/resume`, jsonInit('POST', {}));
}

// ── 저장 키워드·수요·기회 (GET /api/seo/keywords) — 무과금 ────────
export interface ListKeywordsParams {
  domainId: string;
  engine?: SeoEngine;
  market?: Market;
  search?: string; // ≤200자
  cursor?: string;
  limit?: number; // 기본 50·최대 100
}

export async function listKeywords(p: ListKeywordsParams): Promise<Paginated<SeoKeywordDTO>> {
  const qs = new URLSearchParams({ domainId: p.domainId });
  if (p.engine) qs.set('engine', p.engine);
  if (p.market) qs.set('market', p.market);
  if (p.search) qs.set('search', p.search);
  if (p.cursor) qs.set('cursor', p.cursor);
  if (p.limit) qs.set('limit', String(p.limit));
  return request<Paginated<SeoKeywordDTO>>(`/api/seo/keywords?${qs.toString()}`);
}

// ── bounded 리서치·볼륨 갱신 (POST /api/seo/keywords) — scope=research
export interface ResearchKeywordsBody {
  domainId: string;
  runKey: string;
  keywords?: string[]; // 각 1~200자, 최대 50·중복 제거
}

export async function researchKeywords(body: ResearchKeywordsBody): Promise<SeoAuditDTO> {
  return request<SeoAuditDTO>('/api/seo/keywords', jsonInit('POST', body));
}

// ── 저장 스냅샷 이력 (GET /api/seo/rankings) — 무과금 ─────────────
export interface ListRankingsParams {
  domainId: string;
  keywordId?: string;
  engine?: SeoEngine;
  device?: string;
  from?: string; // 기본 최근 30일·최대 366일
  to?: string;
  cursor?: string;
  limit?: number;
}

export async function listRankings(p: ListRankingsParams): Promise<Paginated<SeoRankingDTO>> {
  const qs = new URLSearchParams({ domainId: p.domainId });
  if (p.keywordId) qs.set('keywordId', p.keywordId);
  if (p.engine) qs.set('engine', p.engine);
  if (p.device) qs.set('device', p.device);
  if (p.from) qs.set('from', p.from);
  if (p.to) qs.set('to', p.to);
  if (p.cursor) qs.set('cursor', p.cursor);
  if (p.limit) qs.set('limit', String(p.limit));
  return request<Paginated<SeoRankingDTO>>(`/api/seo/rankings?${qs.toString()}`);
}

// ── 최대 10조합 순위 갱신 (POST /api/seo/rankings) — scope=ranking ─
export interface RefreshRankingsBody {
  domainId: string;
  runKey: string;
  keywordIds: string[]; // ≤10
  engines: SeoEngine[]; // 1~2개, 중복 금지 (실제 조합 ≤10)
}

export async function refreshRankings(body: RefreshRankingsBody): Promise<SeoAuditDTO> {
  return request<SeoAuditDTO>('/api/seo/rankings', jsonInit('POST', body));
}

// ── 도메인 목록 (GET /api/domains) — 기존 GEO Domain 재사용 ────────
// 설계 §8: SEO 전용 Domain 등록 폼 중복 구현 금지. 기존 목록을 공유해 선택만 한다.
export async function listDomains(limit = 100): Promise<DomainDTO[]> {
  return request<DomainDTO[]>(`/api/domains?limit=${limit}`);
}
