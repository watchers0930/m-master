// lib/api/ads.ts — 광고 화면 API 래퍼(Task 12). 서버 계약 = app/api/ads/** + schemas/ads*.ts(strict — 모르는 필드를 보내지 않는다).
// - 응답 봉투 {data}를 벗기고, 오류 {error:{code,message,...details}}는 AdsApiError로 옮긴다(키·본문은 오류에 싣지 않는다).
//   details.naverCode(정수)가 있으면 문구 끝에 ' (네이버 코드 N)'을 붙인다.
// - 변이(POST·PATCH·DELETE)는 브라우저 fetch가 Origin을 자동 첨부한다(서버 requireOrigin). 별도 CSRF 토큰 없음(코드베이스 표준).
// - 키는 요청 본문에만 싣는다(URL·로그 없음). 모든 요청 cache: no-store.
'use client';

import type {
  AdAccountDTO, AdAccountWithChannels, AdApplyResultDTO, AdLockEntityType, AdLockResultDTO, AdOverviewDTO,
  AdProposalDTO, AdProposalKind, AdProposalPage, AdProposalStatus, ProposalPayload,
} from '@/types/ads';

export class AdsApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;
  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'AdsApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type ErrorBody = { code?: unknown; message?: unknown } & Record<string, unknown>;

async function send<T>(url: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store', ...init });
  } catch {
    throw new AdsApiError(0, 'network', '네트워크 오류로 요청하지 못했습니다. 연결을 확인하고 다시 시도하세요.');
  }
  let json: unknown = null;
  try { json = await res.json(); } catch { /* 본문 없음·비JSON — status로 판단 */ }
  const body = (json ?? {}) as { data?: T; error?: ErrorBody };
  if (!res.ok || body.error || !('data' in body)) {
    const { code, message, ...details } = body.error ?? {};
    const base = typeof message === 'string' && message ? message : `요청 실패 (HTTP ${res.status})`;
    // 네이버 오류 코드가 있으면 문구 끝에 붙인다(실운영 2026-11-11: 1002를 화면에서 바로 읽을 수 있게). 정수만 — 그 밖은 무시
    const naver = Number.isSafeInteger(details.naverCode) ? ` (네이버 코드 ${details.naverCode})` : '';
    throw new AdsApiError(res.status, typeof code === 'string' ? code : 'unknown', base + naver, details);
  }
  return body.data as T;
}

const jsonInit = (method: string, body: unknown): RequestInit =>
  ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const seg = encodeURIComponent;

// ── 계정 ──
export type AdsConnectBody = { customerId: string; apiKey: string; secretKey: string; label: string };

export const listAdAccounts = () => send<AdAccountDTO[]>('/api/ads/accounts');
export const connectAdAccount = (input: AdsConnectBody) => send<AdAccountWithChannels>('/api/ads/accounts', jsonInit('POST', input));
export const getAdAccount = (id: string) => send<AdAccountWithChannels>(`/api/ads/accounts/${seg(id)}`);
export const replaceAdKeys = (id: string, keys: { apiKey: string; secretKey: string }) =>
  send<AdAccountDTO>(`/api/ads/accounts/${seg(id)}`, jsonInit('PATCH', { action: 'replace_keys', apiKey: keys.apiKey, secretKey: keys.secretKey }));
export const selectAdChannel = (id: string, channelId: string) =>
  send<AdAccountDTO>(`/api/ads/accounts/${seg(id)}`, jsonInit('PATCH', { action: 'select_channel', channelId }));
export const disconnectAdAccount = (id: string) => send<AdAccountDTO>(`/api/ads/accounts/${seg(id)}`, { method: 'DELETE' });
export const getAdOverview = (id: string) => send<AdOverviewDTO>(`/api/ads/accounts/${seg(id)}/overview`);

// ── 제안 ──
export type AdsProposalListQuery = { take?: number; cursor?: string; status?: AdProposalStatus; accountId?: string };
export type AdsProposalCreateBody = { accountId: string; kind: AdProposalKind; targetAdgroupId?: string; domainId?: string; seeds?: string[] };

export function listAdProposals(q: AdsProposalListQuery) {
  const params = new URLSearchParams();
  for (const key of ['take', 'cursor', 'status', 'accountId'] as const) {
    const v = q[key];
    if (v !== undefined && v !== '') params.set(key, String(v));
  }
  const qs = params.toString();
  return send<AdProposalPage>(`/api/ads/proposals${qs ? `?${qs}` : ''}`);
}
export const createAdProposal = (input: AdsProposalCreateBody) => send<AdProposalDTO>('/api/ads/proposals', jsonInit('POST', input));
export const getAdProposal = (id: string) => send<AdProposalDTO>(`/api/ads/proposals/${seg(id)}`);
export const editAdProposal = (id: string, expectedUpdatedAt: string, payload: ProposalPayload) =>
  send<AdProposalDTO>(`/api/ads/proposals/${seg(id)}`, jsonInit('PATCH', { expected_updated_at: expectedUpdatedAt, payload }));

export function reviewAdProposal(id: string, decision: 'approve' | 'reject', expectedUpdatedAt: string, reason?: string) {
  const trimmed = reason?.trim();
  const body = { decision, expected_updated_at: expectedUpdatedAt, ...(trimmed ? { reason: trimmed } : {}) };
  return send<AdProposalDTO>(`/api/ads/proposals/${seg(id)}/review`, jsonInit('POST', body));
}
export const applyAdProposal = (id: string) => send<AdApplyResultDTO>(`/api/ads/proposals/${seg(id)}/apply`, { method: 'POST' });

// ── 켜기·끄기(끄기는 서버가 버전과 무관하게 이기지만 스키마상 버전은 늘 보낸다) ──
export const setAdLock = (type: AdLockEntityType, id: string, locked: boolean, expectedLockVersion: number) =>
  send<AdLockResultDTO>(`/api/ads/entities/${seg(type)}/${seg(id)}/lock`, jsonInit('POST', { locked, expected_lock_version: expectedLockVersion }));
