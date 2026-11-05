// lib/analytics/ga4-block-text.ts
// GA4 블록 실패 상태 → 한글 안내 문구 단일 출처 (설계 §2.4 표). 순수 함수 — UI(Ga4BlockState)와
// 컴포넌트 밖 소비처(스케줄러 자동편성 등)가 같은 문구를 쓴다.
import type { Ga4Block } from '@/types/ga4';

/** 성공이 아닌 블록 */
export type Ga4FailedBlock = Exclude<Ga4Block<unknown>, { state: 'ok' }>;

export const GA4_FAILURE_MESSAGES: Record<Ga4FailedBlock['state'], string> = {
  not_configured: 'GA4 연결 필요',
  unmapped: '이 도메인은 GA4 속성과 연결되지 않았습니다',
  domain_required: '도메인을 선택하세요',
  binding_disabled: 'GA4 연결이 비활성화되었습니다',
  error: 'GA4 연결 오류',
};

/** 짧은 한 줄 문구 (KPI 칸·배지 등 좁은 자리용) */
export function ga4FailureText(block: Ga4FailedBlock): string {
  if (block.state === 'error') return block.retryable ? 'GA4 연결 오류 · 잠시 후 다시 시도' : 'GA4 연결 오류';
  return GA4_FAILURE_MESSAGES[block.state];
}
