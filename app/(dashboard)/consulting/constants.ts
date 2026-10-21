// app/(dashboard)/consulting/constants.ts
// 마케팅 컨설팅 대시보드 전용 표시 라벨·색상·포맷터 (UI 전용, 서버 검증과 무관).
// 시장/통화/채널의 '진짜' 지원 범위·검증·수치 계산은 서버(lib/)가 담당. 여기 값은 화면 표기용.
// evidence 토큰 치환은 '서버가 검증해 전달한 evidence 값을 조회해 표시'하는 것이며,
// 프론트에서 비율·금액을 재계산하지 않는다(설계 §3.4·§7).

import type { Market } from '@/types/visibility';
import type {
  ConsultingStatus,
  ChannelKey,
  ActionPriority,
  ActionDestination,
  Currency,
  EvidenceSource,
  EvidenceRef,
} from './types';

/** 기본 시장 (lib/market 이 최종 소유 → UI 는 로컬 기본값만 사용) */
export const DEFAULT_MARKET: Market = 'ko-KR';

export const MARKET_LABELS: Record<Market, string> = {
  'ko-KR': '한국 · ko-KR',
  'en-US': '미국 · en-US',
  'en-GB': '영국 · en-GB',
  'en-CA': '캐나다 · en-CA',
  'en-AU': '호주 · en-AU',
};

/** 시장별 기본 통화 (설계 §4.2: currency 는 market 기본 통화와 일치해야 함 — 서버 최종 검증) */
export const MARKET_CURRENCY: Record<Market, Currency> = {
  'ko-KR': 'KRW',
  'en-US': 'USD',
  'en-GB': 'GBP',
  'en-CA': 'CAD',
  'en-AU': 'AUD',
};

export const CURRENCY_SYMBOL: Record<Currency, string> = {
  KRW: '₩',
  USD: '$',
  GBP: '£',
  CAD: 'CA$',
  AUD: 'A$',
};

/** 채널 라벨·색 (설계 §0: organic·geo·naver_paid 3개 고정) */
export const CHANNEL_LABELS: Record<ChannelKey, string> = {
  organic: '오가닉(SEO)',
  geo: 'GEO(AI 가시성)',
  naver_paid: '네이버 광고',
};

export const CHANNEL_COLORS: Record<ChannelKey, string> = {
  organic: '#1b356f',
  geo: '#2a7d5f',
  naver_paid: '#9a6a1c',
};

export const CHANNEL_DESC: Record<ChannelKey, string> = {
  organic: '검색엔진 자연 노출 — 콘텐츠·기술 SEO',
  geo: 'AI 답변 내 인용·언급 점유',
  naver_paid: '네이버 검색/디스플레이 유료 집행(한국 시장)',
};

export const STATUS_META: Record<ConsultingStatus, { label: string; color: string; bg: string }> = {
  generating: { label: '생성 중', color: 'var(--amber-700)', bg: 'var(--amber-100)' },
  completed: { label: '완료', color: 'var(--green-700)', bg: 'var(--green-100)' },
  failed: { label: '검증 실패', color: '#dc2626', bg: '#fee2e2' },
  uncertain: { label: '비용 미확정', color: '#dc2626', bg: '#fee2e2' },
};

export const PRIORITY_META: Record<ActionPriority, { label: string; color: string; bg: string }> = {
  P0: { label: 'P0 · 즉시', color: '#dc2626', bg: '#fee2e2' },
  P1: { label: 'P1 · 단기', color: 'var(--amber-700)', bg: 'var(--amber-100)' },
  P2: { label: 'P2 · 중기', color: 'var(--blue-400)', bg: 'var(--n100)' },
};

/** 소스 상태 라벨 (설계 §3.1: 실제 관측 0 과 미수집 null 을 구분) */
export const SOURCE_LABELS: Record<EvidenceSource, string> = {
  seo: 'SEO',
  geo: 'GEO',
  ga4: 'GA4 성과',
  status: '데이터 상태',
};

export const SOURCE_STATUS_META: Record<string, { label: string; color: string }> = {
  available: { label: '수집됨', color: 'var(--green-700)' },
  partial: { label: '부분 수집', color: 'var(--amber-700)' },
  stale: { label: '오래된 데이터', color: 'var(--amber-700)' },
  missing: { label: '미수집', color: 'var(--sub)' },
  unmapped: { label: '매핑 불가', color: 'var(--sub)' },
  error: { label: '조회 오류', color: '#dc2626' },
};

/**
 * 액션 목적지 enum → 앱 내 경로 매핑 (설계 §0·§7).
 * enum 은 서버 allowlist 값이며, 프론트는 '고정 경로'로만 변환한다(LLM 이 URL 을 만들지 못함).
 * - content_create: 검증된 title 만 topic 쿼리로 URL 인코딩 전달
 * - seo_audit / visibility: domainId 쿼리 기반 선택 최소 보완(대상 도메인 재선택용)
 */
export function destinationHref(
  destination: ActionDestination,
  ctx: { domainId: string; title: string },
): string {
  switch (destination) {
    case 'content_create':
      return `/content/create?topic=${encodeURIComponent(ctx.title)}`;
    case 'seo_audit':
      return `/seo-audit?domainId=${encodeURIComponent(ctx.domainId)}`;
    case 'visibility':
      return `/visibility?domainId=${encodeURIComponent(ctx.domainId)}`;
    default:
      return '/home';
  }
}

export const DESTINATION_CTA: Record<ActionDestination, string> = {
  content_create: '콘텐츠 생성으로',
  seo_audit: 'SEO 진단으로',
  visibility: 'AI 가시성으로',
};

/** 관측값(evidence.value) + 단위를 표시 문자열로. null = '미관측'(0 아님) */
export function formatEvidenceValue(ev: EvidenceRef | undefined): string {
  if (!ev) return '(근거 없음)';
  if (ev.value === null || ev.value === undefined) return '미관측';
  const base = typeof ev.value === 'number' ? ev.value.toLocaleString('ko-KR') : ev.value;
  return ev.unit ? `${base}${ev.unit}` : String(base);
}

const TOKEN_RE = /\{\{ev:([a-zA-Z0-9_.-]+)\}\}/g;

/**
 * 자유 서술 내 {{ev:id}} 토큰을 '서버가 검증해 전달한' evidence 값으로 치환한다(설계 §3.4·§7).
 * 재계산이 아니라 조회·표시다. 미존재 토큰은 서버 검증(§4.3-2)을 통과했다는 전제이나,
 * 방어적으로 '(근거 없음)'으로 표시해 허구 수치가 새지 않게 한다.
 */
export function renderEvidenceTokens(text: string, evidenceById: Map<string, EvidenceRef>): string {
  if (!text) return '';
  return text.replace(TOKEN_RE, (_m, id: string) => formatEvidenceValue(evidenceById.get(id)));
}

/** 금액 표시: null = '비율만 제안'(미입력), 숫자는 통화 기호 + 로케일 */
export function formatAmount(amount: number | null, currency: Currency): string {
  if (amount === null || amount === undefined) return '—';
  return `${CURRENCY_SYMBOL[currency]}${amount.toLocaleString('ko-KR')}`;
}

/** 비율(0~100 정수) → '45%' */
export function formatRatio(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined) return '—';
  return `${ratio}%`;
}

/** ISO 시각 → YYYY-MM-DD HH:MM (로컬) */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO 시각 → YYYY-MM-DD */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return iso.slice(0, 10);
}

// ─────────────────────────────────────────────────────────────
// 구조화 리포트 v2 — 6섹션 표시용 라벨·포맷터 (설계 §3.3)
// 전부 '표시만'. 수치·파생값·증감은 서버가 산출한 값만 보여주며 프론트는 재계산하지 않는다.
// ─────────────────────────────────────────────────────────────

/** 섹션 데이터 상태 → degrade 여부 ("준비 필요" = 근거 없음) */
export function isSectionDegraded(status: string): boolean {
  return status === 'missing' || status === 'unmapped' || status === 'error';
}

/** 광고 경쟁도(문자열 enum) 라벨 — 자연검색 난이도(difficulty)와 구분 */
export const AD_COMPETITION_LABELS: Record<string, string> = {
  LOW: '낮음',
  MEDIUM: '보통',
  HIGH: '높음',
};

export function formatAdCompetition(v: string | null | undefined): string {
  if (v === null || v === undefined) return '미관측';
  return AD_COMPETITION_LABELS[v] ?? v;
}

/** 정수/소수 관측값 — null = '미관측'(0 과 구분). 관측 0 은 '0'으로 표시 */
export function formatMetric(v: number | null | undefined, opts?: { decimals?: number; suffix?: string }): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '미관측';
  const base =
    opts?.decimals != null
      ? v.toLocaleString('ko-KR', { minimumFractionDigits: opts.decimals, maximumFractionDigits: opts.decimals })
      : v.toLocaleString('ko-KR');
  return opts?.suffix ? `${base}${opts.suffix}` : base;
}

/** year·month → 'YYYY-MM' (month 범위 밖이면 그대로 방어 표기) */
export function formatYearMonth(year: number, month: number): string {
  const mm = month >= 1 && month <= 12 ? String(month).padStart(2, '0') : String(month);
  return `${year}-${mm}`;
}

/** 통화 코드가 확정된 CPC/금액 — 미확정(null)이면 '통화 미확정'(금액 의미 집계 미생성과 일치) */
export function formatCurrencyMetric(v: number | null | undefined, currency: Currency | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '미관측';
  if (!currency) return `${v.toLocaleString('ko-KR')} (통화 미확정)`;
  return `${CURRENCY_SYMBOL[currency]}${v.toLocaleString('ko-KR')}`;
}

/** 커버리지(0~1) → '72%'. null = 표기 생략 */
export function formatCoverage(v: number | null | undefined): string | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const pct = Math.round(Math.max(0, Math.min(1, v)) * 100);
  return `${pct}%`;
}
