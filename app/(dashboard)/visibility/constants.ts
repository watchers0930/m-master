// app/(dashboard)/visibility/constants.ts
// AI 가시성 대시보드 전용 표시 라벨·색상 상수 (UI 전용, 서버 검증과 무관)
// 시장/엔진의 '진짜' 지원 범위·검증은 서버(lib/market)가 담당. 여기 값은 화면 표기용.

import type { EngineId, Market, Frequency, SnapshotStatus } from '@/types/visibility';

/** 기본 시장 (설계 §4.1 DEFAULT_MARKET 은 lib/market 소유 → UI 는 로컬 기본값만 사용) */
export const DEFAULT_MARKET: Market = 'ko-KR';

/** 전 시장 공통 4엔진 (설계 §0: 전 시장 4엔진). 선택 UI 기본 노출용. */
export const ALL_ENGINES: EngineId[] = ['chatgpt', 'ai_overviews', 'perplexity', 'gemini'];

export const ENGINE_LABELS: Record<EngineId, string> = {
  chatgpt: 'ChatGPT',
  ai_overviews: 'AI Overviews',
  perplexity: 'Perplexity',
  gemini: 'Gemini',
};

/** 엔진별 포인트 색 (대시보드 네이비 톤 계열 + 구분) */
export const ENGINE_COLORS: Record<EngineId, string> = {
  chatgpt: '#1b356f',
  ai_overviews: '#2a7d5f',
  perplexity: '#6f8fd0',
  gemini: '#b45309',
};

export const MARKET_LABELS: Record<Market, string> = {
  'ko-KR': '한국 · ko-KR',
  'en-US': '미국 · en-US',
  'en-GB': '영국 · en-GB',
  'en-CA': '캐나다 · en-CA',
  'en-AU': '호주 · en-AU',
};

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  daily: '매일',
  weekly: '매주',
};

export const STATUS_META: Record<SnapshotStatus, { label: string; color: string; bg: string }> = {
  ok: { label: '수집 완료', color: 'var(--green-700)', bg: 'var(--green-100)' },
  no_result: { label: '결과 없음', color: 'var(--sub)', bg: 'var(--n100)' },
  failed: { label: '수집 실패', color: '#dc2626', bg: '#fee2e2' },
  pending: { label: '판정 대기', color: 'var(--amber-700)', bg: 'var(--amber-100)' },
};

/** 비율(0~1 또는 null) → 표시 문자열. null 은 '데이터 없음'(0% 아님, 설계 §3.8·§4.5). */
export function formatRate(rate: number | null): string {
  if (rate === null || rate === undefined) return '—';
  return `${(rate * 100).toFixed(0)}%`;
}

/** ISO 날짜 문자열 → YYYY-MM-DD */
export function toDateInput(iso: string): string {
  return iso.slice(0, 10);
}
