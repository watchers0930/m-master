// app/(dashboard)/consulting/api.ts
// 마케팅 컨설팅 기능 전용 API 래퍼 (프론트 → /api/consulting, /api/domains).
// 설계 §6.5 계약을 그대로 호출만 한다. 알고리즘/검증/소유권/비용은 서버(lib/·app/api/) 책임.
// envelope 규약: 성공 { data: T } / 실패 { error: { code, message } } (설계 §6.5 공통 규약).
// 경로·메서드·요청/응답 형태는 설계 §6.5 를 정확히 따른다.

import type { DomainDTO } from '@/types/visibility';
import type { ConsultingReportDTO, MonthlyBudgetInput, Market, Paginated } from './types';

/** 서버 에러 code 를 보존해 UI 분기(데이터 부족/플랜/한도/충돌/예산 등)에 사용 (설계 §6.6) */
export class ConsultingApiError extends Error {
  code: string;
  status: number;
  /** generation_in_progress 응답에 동봉되는 기존 리포트 ID (설계 §6.5) — 폴링 대상 */
  reportId?: string;
  constructor(status: number, code: string, message: string, reportId?: string) {
    super(message);
    this.name = 'ConsultingApiError';
    this.status = status;
    this.code = code;
    this.reportId = reportId;
  }
}

async function request<T>(url: string, init?: RequestInit, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, signal ? { ...init, signal } : init);
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* 본문 없음/비JSON — 아래에서 status 로 처리 */
  }
  const body = (json ?? {}) as {
    data?: T;
    error?: { code?: string; message?: string; reportId?: string };
  };
  if (!res.ok || body.error) {
    const code = body.error?.code ?? 'unknown';
    const message = body.error?.message ?? `요청 실패 (HTTP ${res.status})`;
    throw new ConsultingApiError(res.status, code, message, body.error?.reportId);
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

// ── 신규 생성 / 동일 입력 재사용 (POST /api/consulting) ────────────
// 설계 §6.5: 201=신규 완료 / 200=동일 입력 기존 완료 재사용(LLM·원장 없음).
// request() 는 2xx 를 모두 통과시키므로 두 경우 모두 ConsultingReportDTO(status=completed) 를 반환.
// 멱등 키는 서버가 inputSnapshotHash 로 관리(§6.2) — 요청 본문엔 해시·owner·상태를 넣지 않는다.
export interface CreateReportBody {
  domainId: string; // 소유 Domain cuid
  market?: Market; // 선택 — 있으면 Domain 과 일치해야 함(서버 검증)
  monthlyMarketingBudget?: MonthlyBudgetInput; // 선택 — amount 정수 0 이상, currency 는 market 기본 통화
}

export async function createReport(body: CreateReportBody): Promise<ConsultingReportDTO> {
  return request<ConsultingReportDTO>('/api/consulting', jsonInit('POST', body));
}

// ── 단건 상세 조회 (GET /api/consulting?domainId&reportId) — 무과금 ─
export async function fetchReport(
  domainId: string,
  reportId: string,
  signal?: AbortSignal,
): Promise<ConsultingReportDTO> {
  const qs = new URLSearchParams({ domainId, reportId });
  return request<ConsultingReportDTO>(`/api/consulting?${qs.toString()}`, undefined, signal);
}

// ── 이력 목록 조회 (GET /api/consulting?domainId) — 무과금, 최신순 ──
export interface ListReportsParams {
  domainId: string;
  cursor?: string;
  limit?: number; // 기본 20·최대 100
}

export async function listReports(
  p: ListReportsParams,
  signal?: AbortSignal,
): Promise<Paginated<ConsultingReportDTO>> {
  const qs = new URLSearchParams({ domainId: p.domainId });
  if (p.cursor) qs.set('cursor', p.cursor);
  if (p.limit) qs.set('limit', String(p.limit));
  return request<Paginated<ConsultingReportDTO>>(`/api/consulting?${qs.toString()}`, undefined, signal);
}

// ── 도메인 목록 (GET /api/domains) — 기존 GEO/SEO Domain 재사용 ────
// 컨설팅 전용 Domain 등록 폼은 만들지 않는다. 기존 목록을 공유해 선택만 한다(설계 §7).
export async function listDomains(q = '', cursor?: string, signal?: AbortSignal): Promise<Paginated<DomainDTO>> {
  const params = new URLSearchParams({ q, limit: '50' });
  if (cursor) params.set('cursor', cursor);
  return request<Paginated<DomainDTO>>(`/api/consulting/domains?${params}`, undefined, signal);
}
export async function fetchDomain(domainId: string, signal?: AbortSignal): Promise<DomainDTO> {
  const result = await request<Paginated<DomainDTO>>(`/api/consulting/domains?${new URLSearchParams({ domainId })}`, undefined, signal);
  return result.items[0];
}
