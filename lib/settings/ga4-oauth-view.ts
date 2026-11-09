// lib/settings/ga4-oauth-view.ts — 설정 › GA4 Google 계정 행의 표시 규칙(순수 함수, 클라이언트 공용)
// - 저장 자격증명 복호화 실패(credential_storage_error): 관리자 경고를 항상 보인다.
//   · '연결 해제'는 항상 보인다(삭제에는 복호화가 필요 없다 — 열리지 않는 행을 지우는 복구 경로).
//   · 재연결은 사유가 not_configured(운영 env 키 누락·형식 오류)일 때만 숨긴다 — 그때는 저장도 거부되므로 눌러도 실패한다.
//     key_mismatch·invalid_blob(행이 다른 키·변조)는 재연결이 현재 키로 다시 저장해 복구한다.
import type { Ga4SettingsDTO } from '@/lib/api/ga4-settings';

export const CREDENTIAL_STORAGE_WARNING = '관리자 설정 오류(자격증명 키) — 재연결하지 마세요';

export interface Ga4OauthView {
  status: 'connected' | 'disconnected' | 'storage_error';
  warning: string | null;
  showReconnect: boolean;
  showDisconnect: boolean;
  reconnectLabel: string;
}

export function ga4OauthView(s: Pick<Ga4SettingsDTO, 'connected_oauth' | 'oauth_error' | 'oauth_error_reason'>): Ga4OauthView {
  if (s.oauth_error) {
    const envProblem = s.oauth_error_reason === 'not_configured';
    return {
      status: 'storage_error',
      warning: envProblem ? `${CREDENTIAL_STORAGE_WARNING}. 운영자에게 문의해 주세요.`
        : '관리자 설정 오류(자격증명 키) — 저장된 Google 연결을 현재 키로 읽을 수 없습니다. 운영자 확인 후 재연결하거나 연결 해제하세요.',
      showReconnect: !envProblem,
      showDisconnect: true,
      reconnectLabel: 'Google 계정 재연결',
    };
  }
  return {
    status: s.connected_oauth ? 'connected' : 'disconnected',
    warning: null,
    showReconnect: true,
    showDisconnect: s.connected_oauth,
    reconnectLabel: s.connected_oauth ? 'Google 계정 재연결' : 'Google 계정 연결',
  };
}
