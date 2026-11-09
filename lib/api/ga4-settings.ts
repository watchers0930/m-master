// lib/api/ga4-settings.ts
// 설정 화면 GA4 연결 API 래퍼 (GA4 설계 §4.6). 바인딩 생성은 운영자 CLI 전용 — 여기엔 조회·해제·자동화 도메인 저장만.
// 쓰기(DELETE·PUT)는 브라우저 fetch 가 Origin 을 자동 첨부한다(서버 requireOrigin).

export type Ga4BindingStatus = 'pending' | 'verified' | 'error' | 'disabled';

export interface Ga4BindingDTO {
  domain_id: string;
  host: string;
  property_id: string;
  status: Ga4BindingStatus;
  last_checked_at: string | null;
  last_error_code: string | null;
}

export interface Ga4SettingsDTO {
  connected_oauth: boolean;
  oauth_updated_at: string | null;
  /** 저장된 자격증명을 복호화하지 못함(관리자 키 설정 오류). 복구 가능 여부는 oauth_error_recoverable */
  oauth_error: 'credential_storage_error' | null;
  oauth_error_reason: 'not_configured' | 'key_mismatch' | 'invalid_blob' | 'invalid_input' | null;
  /** 런타임 키 = DB 앵커 정본 키 → 열리지 않는 행은 다른 키로 쓴 행 확정 → 재연결·해제로 복구 가능 */
  oauth_error_recoverable: boolean;
  bindings: Ga4BindingDTO[];
  automation_domain_id: string | null;
}

async function send<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...init });
  const j = await res.json().catch(() => null) as (T & { error?: { message?: string } | string | null }) | null;
  if (!res.ok || !j) {
    const e = j?.error;
    const msg = typeof e === 'object' ? e?.message : e;
    throw new Error(msg || (res.status === 404 ? '도메인을 찾을 수 없습니다' : `요청 실패 (HTTP ${res.status})`));
  }
  return j;
}

export function getGa4Settings(): Promise<Ga4SettingsDTO> {
  return send<Ga4SettingsDTO>('/api/settings/ga4');
}

export function disconnectGa4Oauth(): Promise<{ ok: true }> {
  return send<{ ok: true }>('/api/settings/ga4', { method: 'DELETE' });
}

/** PUT /api/settings 부분 갱신 — automation_domain_id 만 보낸다(다른 설정 필드 미변경) */
export function saveAutomationDomain(domainId: string | null): Promise<unknown> {
  return send<unknown>('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ automation_domain_id: domainId }),
  });
}
