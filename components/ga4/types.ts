// components/ga4/types.ts
// GA4 응답 블록 계약 (설계 §2.4). 단일 출처는 백엔드 공용 계약 types/ga4.ts — 여기서는 재노출만 한다.
// UI 전용 파생 타입만 추가한다(중복 정의 금지).
export type { Ga4Block, Ga4ErrorCode, Ga4UnavailableReason } from '@/types/ga4';

/** 성공이 아닌 블록 (Ga4BlockState 컴포넌트 입력) — 정의는 lib/analytics/ga4-block-text.ts */
export type { Ga4FailedBlock } from '@/lib/analytics/ga4-block-text';
