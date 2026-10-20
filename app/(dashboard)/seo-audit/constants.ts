// app/(dashboard)/seo-audit/constants.ts
// SEO 진단 대시보드 전용 표시 라벨·색상 상수 (UI 전용, 서버 검증과 무관).
// 시장/엔진/모드의 '진짜' 지원 범위·검증은 서버(lib/)가 담당. 여기 값은 화면 표기용.

import type { Market } from '@/types/visibility';
import type {
  SeoEngine,
  AuditScope,
  AuditMode,
  AuditStatus,
  CheckStatus,
  RankStatus,
  RankSource,
} from '@/types/seo';

/** 기본 시장 (lib/market 이 최종 소유 → UI 는 로컬 기본값만 사용) */
export const DEFAULT_MARKET: Market = 'ko-KR';

/** SEO 엔진 (설계 §0: google·naver. naver 는 ko-KR 에서만 활성) */
export const SEO_ENGINES: SeoEngine[] = ['google', 'naver'];

export const ENGINE_LABELS: Record<SeoEngine, string> = {
  google: 'Google',
  naver: '네이버',
};

export const ENGINE_COLORS: Record<SeoEngine, string> = {
  google: '#1b356f',
  naver: '#2a7d5f',
};

export const MARKET_LABELS: Record<Market, string> = {
  'ko-KR': '한국 · ko-KR',
  'en-US': '미국 · en-US',
  'en-GB': '영국 · en-GB',
  'en-CA': '캐나다 · en-CA',
  'en-AU': '호주 · en-AU',
};

/** 진단 범위 (설계 §3). full = 기술+리서치+순위 */
export const SCOPE_LABELS: Record<AuditScope, string> = {
  technical: '기술 감사',
  research: '키워드 리서치',
  ranking: '순위 갱신',
  full: '전체 진단',
};

/** 기술 감사 모드 (crawl 페이지 수는 서버 정책으로만 결정) */
export const MODE_LABELS: Record<AuditMode, string> = {
  instant: '대표 URL(즉시)',
  crawl: '크롤(최대 20p)',
};

export const AUDIT_STATUS_META: Record<AuditStatus, { label: string; color: string; bg: string }> = {
  pending: { label: '진행 중', color: 'var(--amber-700)', bg: 'var(--amber-100)' },
  completed: { label: '완료', color: 'var(--green-700)', bg: 'var(--green-100)' },
  partial: { label: '부분 완료', color: 'var(--amber-700)', bg: 'var(--amber-100)' },
  failed: { label: '실패', color: '#dc2626', bg: '#fee2e2' },
};

/** 15체크 판정 상태 (설계 §3·§4). unknown·n/a 는 분모 제외. */
export const CHECK_STATUS_META: Record<CheckStatus, { label: string; color: string; bg: string }> = {
  pass: { label: '통과', color: 'var(--green-700)', bg: 'var(--green-100)' },
  warning: { label: '주의', color: 'var(--amber-700)', bg: 'var(--amber-100)' },
  fail: { label: '실패', color: '#dc2626', bg: '#fee2e2' },
  unknown: { label: '근거 부족', color: 'var(--sub)', bg: 'var(--n100)' },
  not_applicable: { label: '해당 없음', color: 'var(--sub)', bg: 'var(--n100)' },
};

/** 순위 상태 (설계 §5.2). 범위 내 미발견 = rank null (0/101 금지). */
export const RANK_STATUS_META: Record<RankStatus, { label: string; color: string }> = {
  ranked: { label: '순위 확인', color: 'var(--green-700)' },
  not_found_in_range: { label: '범위 내 미발견', color: 'var(--amber-700)' },
  no_result: { label: '결과 없음', color: 'var(--sub)' },
  unsupported: { label: '미지원', color: 'var(--sub)' },
  failed: { label: '수집 실패', color: '#dc2626' },
  pending: { label: '측정 대기', color: 'var(--amber-700)' },
};

/** 순위 출처 (Labs = 데이터베이스 발견, serp = 직접 SERP 관측) */
export const SOURCE_LABELS: Record<RankSource, string> = {
  serp: '직접 SERP',
  labs: 'Labs 발견',
};

/** 세부 작업(operation) 사람이 읽을 라벨 */
export const OPERATION_LABELS: Record<string, string> = {
  automatic_rankings: '자동 순위 수집',
  onpage_instant: '기술 감사(즉시)',
  onpage_crawl: '기술 감사(크롤)',
  labs_ranked: '키워드 발견',
  keywords_for_site: '사이트 키워드·수요',
  naver_volume: '네이버 수요',
  serp_google: 'Google 순위',
  serp_naver: '네이버 순위',
};

/** 커버리지 임계값 (설계 §4.3: 0.7 미만 → '참고 점수' 배지) */
export const COVERAGE_WARN = 0.7;

/** 비율(0~1 또는 null) → 표시 문자열. null 은 '—'(0% 아님). */
export function formatPercent(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return '—';
  return `${Math.round(rate * 100)}%`;
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

/** 관측 결과를 '오래됨'으로 표시하는 기준 일수 (설계 §5.2·§8: 신선도 구분) */
export const STALE_DAYS = 30;

/** 관측 시각이 STALE_DAYS 보다 오래됐는지. 시각 없음/파싱 실패는 '오래됨 아님'(과장 금지). */
export function isStale(iso: string | null | undefined, days = STALE_DAYS): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t > days * 86400000;
}

/** 검색량 표시: 미제공(null)=—, 범위/스케일 있으면 보존해 표기 (임의 0 변환 금지) */
export function formatVolume(volume: number | null, scale: string | null): string {
  if (volume === null || volume === undefined) return scale ?? '—';
  const base = volume.toLocaleString('ko-KR');
  return scale ? `${base} (${scale})` : base;
}
