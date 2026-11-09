// app/(dashboard)/settings/components/Ga4ConnectionCard.tsx
// 설정 › GA4 연결 — Google 계정(OAuth) 연결·해제, 도메인별 GA4 속성 바인딩 상태, 자동화 도메인 선택 (GA4 설계 §4.6·§6).
// 바인딩(도메인↔속성) 생성은 운영자 CLI 전용이라 여기서는 상태만 보여준다. 전역 Property ID 입력은 제거됨(F6).
'use client';

import { useEffect, useState } from 'react';
import { useGa4Settings } from '@/hooks/useGa4Settings';
import { CREDENTIAL_STORAGE_WARNING, ga4OauthView } from '@/lib/settings/ga4-oauth-view';
import { useOwnedDomains } from '@/hooks/useOwnedDomains';
import type { Ga4BindingStatus } from '@/lib/api/ga4-settings';

const STATUS_META: Record<Ga4BindingStatus, { label: string; color: string }> = {
  verified: { label: '연결됨', color: 'var(--green-700)' },
  pending: { label: '확인 대기', color: 'var(--amber-700)' },
  error: { label: '오류', color: '#dc2626' },
  disabled: { label: '비활성', color: 'var(--sub)' },
};

const ERROR_LABELS: Record<string, string> = {
  invalid_credentials: '인증 오류', credential_storage_error: CREDENTIAL_STORAGE_WARNING, permission_denied: '속성 권한 없음', quota_exceeded: '할당량 초과',
  timeout: '시간 초과', upstream_error: 'GA4 응답 오류', invalid_query: '조회 조건 오류',
};

// OAuth 콜백 복귀 쿼리(?ga4=...) 실패 사유 — app/api/auth/ga4/callback/route.ts의 redirect 코드와 1:1
const CALLBACK_ERRORS: Record<string, string> = {
  save_error: `Google 계정은 확인됐지만 자격증명을 저장하지 못했습니다(${CREDENTIAL_STORAGE_WARNING}). 운영자에게 문의해 주세요.`,
  token_error: 'Google 토큰 발급에 실패했습니다. 잠시 후 다시 연결해 주세요.',
  denied: 'Google 계정 연결이 취소되었습니다.',
  invalid_state: '연결 요청이 만료되었거나 올바르지 않습니다. 다시 시도해 주세요.',
  auth_error: '로그인 세션이 만료되었습니다. 다시 로그인 후 연결해 주세요.',
};

const dateText = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('ko-KR') : null);

export default function Ga4ConnectionCard() {
  const { query, disconnect, setAutomationDomain } = useGa4Settings();
  const domains = useOwnedDomains();
  const s = query.data;
  const oauth = ga4OauthView(s ?? { connected_oauth: false, oauth_error: null, oauth_error_reason: null, oauth_error_recoverable: false });

  // OAuth 콜백 복귀(?ga4=connected) — 쿼리 제거 후 서버 상태 재조회
  const { refetch } = query;
  const [callbackError, setCallbackError] = useState<string | null>(null);
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('ga4');
    if (!code) return;
    window.history.replaceState({}, '', '/settings');
    // URL 쿼리(외부 상태)를 읽어 한 번만 반영 — 마운트 시 동기화
    if (code !== 'connected') setCallbackError(CALLBACK_ERRORS[code] ?? 'Google 계정 연결에 실패했습니다.');
    void refetch();
  }, [refetch]);

  const busy = disconnect.isPending || setAutomationDomain.isPending;
  const actionError = (disconnect.error ?? setAutomationDomain.error) as Error | null;

  return (
    <div className="card">
      <div className="card-head">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c400)" strokeWidth="1.8" strokeLinecap="round">
          <path d="M18 20V10M12 20V4M6 20v-6"/>
        </svg>
        <span className="card-title">GA4 분석 연동</span>
        <span style={{ fontSize: 10, color: 'var(--sub)' }}>도메인별 GA4 속성 연결 상태</span>
      </div>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {query.isPending ? (
          <p style={{ fontSize: 12, color: 'var(--sub)', margin: 0 }}>연결 상태를 불러오는 중...</p>
        ) : query.isError || !s ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <p role="alert" style={{ fontSize: 12, color: '#dc2626', margin: 0 }}>GA4 연결 상태를 불러오지 못했습니다.</p>
            <button type="button" className="btn btn-ghost" style={{ fontSize: 11.5 }} onClick={() => { void refetch(); }}>다시 시도</button>
          </div>
        ) : (
          <>
            {/* 도메인 바인딩 */}
            <div>
              <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--sub)', margin: '0 0 6px' }}>연결된 GA4 속성</p>
              {s.bindings.length === 0 ? (
                <p style={{ fontSize: 11.5, color: 'var(--sub)', margin: 0, lineHeight: 1.6 }}>
                  아직 연결된 GA4 속성이 없습니다. 도메인과 GA4 속성 연결은 운영자가 등록합니다 — 연결을 요청해 주세요.
                </p>
              ) : (
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {s.bindings.map((b) => {
                    const meta = STATUS_META[b.status] ?? { label: b.status, color: 'var(--sub)' };
                    return (
                      <li key={b.domain_id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
                        <span style={{ color: 'var(--text)', fontWeight: 600 }}>{b.host}</span>
                        <span style={{ color: 'var(--sub)', fontSize: 11 }}>{b.property_id}</span>
                        <span style={{ color: meta.color, fontSize: 11, fontWeight: 600 }}>{meta.label}</span>
                        {b.last_error_code && <span style={{ color: '#dc2626', fontSize: 11 }}>{ERROR_LABELS[b.last_error_code] ?? b.last_error_code}</span>}
                        {b.last_checked_at && <span style={{ color: 'var(--sub)', fontSize: 10.5 }}>확인 {dateText(b.last_checked_at)}</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* 자동화 도메인 */}
            <div>
              <label htmlFor="automation-domain" style={{ fontSize: 11, fontWeight: 600, color: 'var(--sub)', display: 'block', marginBottom: 4 }}>
                자동화 도메인
              </label>
              <select
                id="automation-domain"
                value={s.automation_domain_id ?? ''}
                disabled={busy || domains.isPending}
                onChange={(e) => setAutomationDomain.mutate(e.target.value || null)}
                style={{ width: '100%', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', padding: '8px 11px', fontSize: 12.5, color: 'var(--text)', fontFamily: 'inherit' }}
              >
                <option value="">사용 안 함</option>
                {(domains.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>{d.url}</option>
                ))}
              </select>
              <p style={{ fontSize: 10.5, color: 'var(--sub)', marginTop: 4 }}>
                주간 전략·토픽·자동 글 생성이 이 도메인 기준으로 실행됩니다. 자동 생성 글은 승인 후에만 게시됩니다.
                {domains.isError && ' (도메인 목록을 불러오지 못했습니다)'}
              </p>
            </div>

            {callbackError && <p role="alert" style={{ fontSize: 11.5, color: '#dc2626', margin: 0 }}>{callbackError}</p>}

            {/* Google 계정 (OAuth) — 표시 규칙은 lib/settings/ga4-oauth-view.ts */}
            {oauth.warning && <p role="alert" style={{ fontSize: 12, color: '#dc2626', margin: 0, lineHeight: 1.6 }}>Google 계정: {oauth.warning}</p>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: oauth.status === 'connected' ? '#22c55e' : oauth.status === 'storage_error' ? '#dc2626' : '#9ca3af', flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: 'var(--text)' }}>
                Google 계정 {oauth.status === 'connected' ? `연결됨${s.oauth_updated_at ? ` (${dateText(s.oauth_updated_at)})` : ''}` : oauth.status === 'storage_error' ? '자격증명 키 오류' : '연결 안됨'}
              </span>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                {oauth.showReconnect && (
                  <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={busy} onClick={() => { window.location.href = '/api/auth/ga4'; }}>
                    {oauth.reconnectLabel}
                  </button>
                )}
                {oauth.showDisconnect && (
                  <button
                    className="btn btn-ghost" style={{ fontSize: 12, color: '#dc2626' }} disabled={busy}
                    onClick={() => { if (window.confirm('Google 계정 연결을 해제할까요?')) disconnect.mutate(); }}
                  >
                    {disconnect.isPending ? '해제 중...' : '연결 해제'}
                  </button>
                )}
              </span>
            </div>

            {actionError && <p role="alert" style={{ fontSize: 11, color: '#dc2626', margin: 0 }}>{actionError.message}</p>}
          </>
        )}
      </div>
    </div>
  );
}
