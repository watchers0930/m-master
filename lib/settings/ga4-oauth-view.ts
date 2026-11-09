// lib/settings/ga4-oauth-view.ts — 설정 › GA4 Google 계정 행의 표시 규칙(순수 함수, 클라이언트 공용)
// 저장 자격증명을 복호화하지 못한 경우(credential_storage_error):
// - 재연결·연결 해제는 recoverable(런타임 키 = DB 앵커 정본 키)일 때만 보인다.
//   그때 열리지 않는 행은 '다른 키로 쓴 행'임이 확정이고, 재연결은 정본 키로 다시 저장하며, 해제는 복호화 없이 지운다.
// - 그 외(not_configured: 키 env 누락·형식 오류 / 런타임 키 ≠ 앵커)는 이 서버의 키가 정본이 아니므로 사용자가 고칠 수 없다
//   → 관리자 경고만 보인다(재연결은 저장이 거부되고, 해제는 정상 행을 잘못 지울 수 있다).
import type { Ga4SettingsDTO } from '@/lib/api/ga4-settings';

/** GA4 오류 코드 라벨(바인딩·출처·리포트 공통) — 행동 지시는 연결 행에서만 한다 */
export const CREDENTIAL_STORAGE_WARNING = '관리자 설정 오류(자격증명 키) — 운영자 확인 필요';

export interface Ga4OauthView {
  status: 'connected' | 'disconnected' | 'storage_error';
  warning: string | null;
  showReconnect: boolean;
  showDisconnect: boolean;
  reconnectLabel: string;
}

type Input = Pick<Ga4SettingsDTO, 'connected_oauth' | 'oauth_error' | 'oauth_error_reason' | 'oauth_error_recoverable'>;

export function ga4OauthView(s: Input): Ga4OauthView {
  if (s.oauth_error) {
    const recoverable = s.oauth_error_recoverable && s.oauth_error_reason !== 'not_configured';
    return {
      status: 'storage_error',
      warning: recoverable
        ? '관리자 설정 오류(자격증명 키) — 저장된 Google 연결이 다른 키로 저장되어 읽을 수 없습니다. 재연결하거나 연결 해제하세요.'
        : '관리자 설정 오류(자격증명 키) — 이 서버의 암호화 키 설정을 운영자가 확인해야 합니다. 재연결·해제하지 말고 운영자에게 문의하세요.',
      showReconnect: recoverable,
      showDisconnect: recoverable,
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
