// app/(dashboard)/consulting/types.ts
// 마케팅 컨설팅 화면 전용 DTO·enum 타입 (프론트 로컬 — 설계 §4.1 공유 계약을 그대로 미러).
// 공유 계약 파일 types/consulting.ts 는 백엔드(Codex)가 소유·생성한다. 병렬 작업 충돌을 피하려
// 프론트는 동일 형태를 이 파일에 로컬 선언해 사용하고, 통합 시 import 경로만 교체하면 된다.
// 이 파일은 런타임 로직을 담지 않는다(타입 전용). 수치·금액 계산·검증은 전부 서버 책임(설계 §4.2·§4.3).

import type { Market } from '@/types/visibility';

export type { Market };

/** 리포트 생성·검증 상태 (설계 §4.1) */
export type ConsultingStatus = 'generating' | 'completed' | 'failed' | 'uncertain';
/** 채널 enum — organic·geo·naver_paid 3개 고정 (설계 §0) */
export type ChannelKey = 'organic' | 'geo' | 'naver_paid';
export type ChannelApplicability = 'applicable' | 'not_applicable';
export type ActionPriority = 'P0' | 'P1' | 'P2';
/** 액션 목적지 enum — 서버 allowlist 로 경로 매핑 (설계 §0·§7) */
export type ActionDestination = 'content_create' | 'seo_audit' | 'visibility';
export type Currency = 'KRW' | 'USD' | 'GBP' | 'CAD' | 'AUD';
/** evidence 소스 (설계 §3.4) */
export type EvidenceSource = 'seo' | 'geo' | 'ga4' | 'status';

/** 관측 사실 근거 — 서버가 생성, 토큰 치환·근거 표시용 (설계 §3.4) */
export interface EvidenceRef {
  id: string;
  source: EvidenceSource;
  label: string;
  value: number | string | null; // null = 미관측(0 아님)
  unit?: string;
  observedAt: string | null;
  rangeFrom?: string | null;
  rangeTo?: string | null;
}

export interface DiagnosisPoint {
  text: string;
  evidenceIds: string[];
}
export interface Diagnosis {
  summary: string; // 수치는 {{ev:id}} 토큰만
  strengths: DiagnosisPoint[];
  issues: DiagnosisPoint[];
  uncertainties: string[];
}

export interface ChannelRecommendation {
  channel: ChannelKey;
  applicability: ChannelApplicability;
  recommendedRatio: number; // 0~100 정수. not_applicable → 0
  reason: string;
  evidenceIds: string[];
}

export interface BudgetAllocation {
  channel: ChannelKey;
  ratio: number;
  amount: number | null; // 서버 계산. totalAmount 미입력 → null
}
export interface BudgetProposal {
  totalAmount: number | null;
  currency: Currency;
  allocations: BudgetAllocation[];
  assumptions: string[];
}

export interface PriorityAction {
  id: string;
  priority: ActionPriority;
  channel: ChannelKey;
  title: string;
  description: string; // 수치는 토큰만
  evidenceIds: string[];
  metric: string;
  destination: ActionDestination;
}

export interface SourceStatus {
  source: EvidenceSource;
  status: string; // available | partial | missing | stale | error | unmapped
  observedAt: string | null;
  reason: string | null;
}

/** 컨설팅 리포트 응답 DTO (설계 §4.1) */
export interface ConsultingReportDTO {
  id: string;
  domainId: string;
  market: Market;
  status: ConsultingStatus;
  failCode: string | null;
  diagnosis: Diagnosis | null;
  channelMix: ChannelRecommendation[] | null;
  budgetProposal: BudgetProposal | null;
  priorityActions: PriorityAction[] | null;
  limitations: string[];
  sourceStatus: SourceStatus[];
  evidence: EvidenceRef[];
  /** v2 구조화 6섹션 집계(설계 §3.3). v1 리포트·미준비는 null/undefined → 프론트가 "준비 필요"로 degrade */
  sections?: ConsultingSectionsDTO | null;
  range: { from: string; to: string };
  schemaVersion: string;
  promptVersion: string;
  model: string;
  createdAt: string;
  generatedAt: string | null;
}

// ─────────────────────────────────────────────────────────────
// 구조화 리포트 v2 — 6섹션 DTO (설계 P1 §3.3 "프론트 소비 계약" 로컬 미러)
// 공유 계약 types/consulting.ts 는 백엔드(Codex)가 소유·생성한다. 병렬 충돌을 피하려
// 프론트는 동일 형태를 로컬 선언해 쓰고, 통합 시 import 경로만 교체한다(이 파일 상단 정책).
// 프론트는 이 DTO 를 '표시만' 한다 — 수치·금액·증감·파생값을 재계산하지 않는다(설계 §3.3).
// ─────────────────────────────────────────────────────────────

/** 섹션 데이터 상태 (설계 §3.3). "준비 필요" = missing|unmapped|error 로 degrade */
export type SectionSourceStatus =
  | 'available'
  | 'partial'
  | 'missing'
  | 'stale'
  | 'error'
  | 'unmapped';

/** 선택 규칙·표본 (키워드 ≤N 선정 근거) */
export interface SectionSelection {
  total: number;
  selected: number;
  limit: number;
  rule: string;
}

/** 섹션 공통 메타 — 모든 수치의 근거·기간·출처·커버리지 (설계 §3.3) */
export interface SectionMeta {
  sourceStatus: SectionSourceStatus;
  reason: string | null; // degrade 사유
  evidenceIds: string[]; // 스냅샷 evidence 에 실존하는 근거 ID
  observedAt: string | null; // ISO
  market: string;
  location: number | null;
  period: { from: string; to: string } | null;
  unit: string | null;
  currency: Currency | null;
  selection: SectionSelection | null;
  coverage: number | null; // 0~1 부분 자료 비율
}

/** 04 GTM — 기존 strategyJson 재노출(신규 LLM 없음). 기존 상위 DTO 필드와 동형 */
export interface ConsultingStrategy {
  diagnosis: Diagnosis | null;
  channelMix: ChannelRecommendation[] | null;
  budgetProposal: BudgetProposal | null;
  priorityActions: PriorityAction[] | null;
}

/** 01 수요추이 — 월·지역 검색량 시계열(결측 월은 0 으로 채우지 않음) */
export interface SummarySection {
  meta: SectionMeta;
  monthly: Array<{ location: number; year: number; month: number; volume: number; evidenceId: string }>;
  observedMonths: string[];
  missingMonths: string[];
}

/** 02 우선순위 — 관측 지표만(종합 점수·4분면 임계값·전망은 서버 미생성) */
export interface FocusItem {
  keywordId: string;
  difficulty: number | null;
  volume: number | null;
  cpc: number | null;
  adCompetition: string | null;
  adValue: number | null;
  evidenceIds: string[];
}
export interface FocusSection {
  meta: SectionMeta;
  items: FocusItem[];
}

/** 03 경쟁 — 기존 GEO 근거만. SERP organic 근거 없으면 items=null + 준비필요 */
export interface CompetitorItem {
  source: 'geo';
  name: string;
  metric: string;
  value: number;
  evidenceId: string;
}
export interface CompetitorsSection {
  meta: SectionMeta;
  items: CompetitorItem[] | null;
}

export interface GtmSection {
  meta: SectionMeta;
  strategy: ConsultingStrategy | null;
}

/** 05 전체 키워드 — 관측 지표·직접 순위·출처·기간·상태 */
export interface KeywordRow {
  keywordId: string;
  keyword: string;
  difficulty: number | null;
  volume: number | null;
  cpc: number | null;
  adCompetition: string | null; // 광고 경쟁도 — 자연검색 난이도(difficulty)와 구분
  adValue: number | null; // 서버 계산 volume×cpc 참고값(실광고비·매출 아님)
  rank: number | null;
  rankSource: string | null;
  period: { from: string; to: string } | null;
  status: string;
}
export interface KeywordsSection {
  meta: SectionMeta;
  rows: KeywordRow[];
}

/** 06 지표 정의·출처·산식·버전 */
export interface MetricDef {
  key: string;
  definition: string;
  source: string;
  formula: string | null;
  version: string;
}
export interface MethodologySection {
  meta: SectionMeta;
  metricDefs: MetricDef[];
  selectionLimits: Array<SectionSelection | null>;
}

/** 6섹션 집계 결과 — 서버가 v2 스냅샷에 저장, GET 상세가 반환(설계 §3.3) */
export interface ConsultingSectionsDTO {
  summary: SummarySection;
  focus: FocusSection;
  competitors: CompetitorsSection;
  gtm: GtmSection;
  keywords: KeywordsSection;
  methodology: MethodologySection;
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

/** 월 마케팅 예산 입력 (설계 §5 consultingCreateSchema.monthlyMarketingBudget) */
export interface MonthlyBudgetInput {
  amount: number; // 정수 0 이상
  currency: Currency;
}
