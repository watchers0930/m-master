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
  range: { from: string; to: string };
  schemaVersion: string;
  promptVersion: string;
  model: string;
  createdAt: string;
  generatedAt: string | null;
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
