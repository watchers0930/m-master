// app/(dashboard)/components/domain/api.ts
// 분석 섹션 공통 도메인 API (GET·POST /api/domains). 화면별 중복 호출 래퍼 대신
// 공통 DomainBar·생성 훅이 쓰는 단일 소스. 서버가 owner 스코프로 검증한다(IDOR 차단).
'use client';

import type { DomainDTO, Market } from '@/types/visibility';

export class DomainApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'DomainApiError';
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
  const body = (json ?? {}) as { data?: T; error?: { code?: string; message?: string } };
  if (!res.ok || body.error) {
    const code = body.error?.code ?? 'unknown';
    const message = body.error?.message ?? `요청 실패 (HTTP ${res.status})`;
    throw new DomainApiError(res.status, code, message);
  }
  return body.data as T;
}

export interface CreateDomainBody {
  url: string;
  market?: Market;
  businessType?: string;
}

/** 소유 도메인 목록 (최대 limit, 기본 100). 공통 바의 선택 드롭다운 소스. */
export async function listDomains(limit = 100): Promise<DomainDTO[]> {
  return request<DomainDTO[]>(`/api/domains?limit=${limit}`);
}

/** 신규 도메인 등록. origin 기반 CSRF 는 서버 authenticated 가 검증(커스텀 헤더 불필요). */
export async function createDomain(body: CreateDomainBody): Promise<DomainDTO> {
  return request<DomainDTO>('/api/domains', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
