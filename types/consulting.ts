import type { Market } from "@/types/visibility";
export type ConsultingStatus = "generating" | "completed" | "failed" | "uncertain";
export type ChannelKey = "organic" | "geo" | "naver_paid";
export type ChannelApplicability = "applicable" | "not_applicable";
export type ActionPriority = "P0" | "P1" | "P2";
export type ActionDestination = "content_create" | "seo_audit" | "visibility";
export type Currency = "KRW" | "USD" | "GBP" | "CAD" | "AUD";
export interface Diagnosis {
    summary: string; // ≤600자. 수치는 {{ev:id}} 토큰만
    strengths: {
        text: string;
        evidenceIds: string[];
    }[]; // ≤5
    issues: {
        text: string;
        evidenceIds: string[];
    }[]; // ≤5
    uncertainties: string[]; // 누락·불확실성 ≤5
}
export interface ChannelRecommendation {
    channel: ChannelKey;
    applicability: ChannelApplicability;
    recommendedRatio: number; // 0~100 정수. not_applicable → 0
    reason: string; // 수치는 토큰만
    evidenceIds: string[]; // ≥1
}
export interface BudgetProposal {
    totalAmount: number | null; // 사용자 입력 총액 또는 null
    currency: Currency;
    allocations: {
        channel: ChannelKey;
        ratio: number;
        amount: number | null;
    }[];
    assumptions: string[]; // ≤5
}
export interface PriorityAction {
    id: string; // 스냅샷 내 유일
    priority: ActionPriority;
    channel: ChannelKey;
    title: string; // ≤80자
    description: string; // 실행 설명. 수치는 토큰만
    evidenceIds: string[]; // ≥1
    metric: string; // 관측할 지표
    destination: ActionDestination; // 서버 allowlist로 URL 매핑
}
export interface ConsultingReportDTO {
    sections?: ConsultingSectionsDTO;
    id: string;
    domainId: string;
    market: Market; // types/visibility 재사용
    status: ConsultingStatus;
    failCode: string | null;
    diagnosis: Diagnosis | null;
    channelMix: ChannelRecommendation[] | null;
    budgetProposal: BudgetProposal | null;
    priorityActions: PriorityAction[] | null;
    limitations: string[]; // 누락·오래된 데이터·부분 표본 등
    sourceStatus: {
        source: EvidenceSource;
        status: string;
        observedAt: string | null;
        reason: string | null;
    }[];
    evidence: EvidenceRef[]; // 토큰 치환·근거 표시용(서버 생성)
    range: {
        from: string;
        to: string;
    };
    schemaVersion: string;
    promptVersion: string;
    model: string;
    createdAt: string;
    generatedAt: string | null;
}
/** History projection; evidence and the complete strategy are detail-only. */
export type ConsultingReportSummaryDTO = Pick<ConsultingReportDTO,
    "id" | "domainId" | "market" | "status" | "failCode" | "budgetProposal" |
    "schemaVersion" | "promptVersion" | "model" | "createdAt" | "generatedAt"
> & { diagnosisSummary: string | null };
export type EvidenceSource = "seo" | "geo" | "ga4" | "status";
export interface EvidenceRef {
    id: string; // 'seo_tech_score' 등 안정적 slug (스냅샷 내 유일)
    source: EvidenceSource;
    label: string; // 사람이 읽는 설명(수집 문자열은 untrusted로 분리 전달)
    value: number | string | null; // 실제 관측값. null=미관측(0 아님)
    unit?: string; // '%', '점', '건', 'position' 등
    observedAt: string | null;
    rangeFrom?: string | null;
    rangeTo?: string | null;
}
export type SectionMeta = import("zod").infer<typeof import("@/schemas/consulting-sections").sectionMetaSchema>;
export type StructuredMetrics = import("zod").infer<typeof import("@/schemas/consulting-sections").structuredMetricsSchema>;
export interface ConsultingSectionsDTO {
    summary: {meta: SectionMeta; monthly: {location:number; year:number; month:number; volume:number; evidenceId:string}[]; observedMonths:string[]; missingMonths:string[]};
    focus: {meta: SectionMeta; items: {keywordId:string; difficulty:number|null; volume:number|null; cpc:number|null; adCompetition:string|null; adValue:number|null; metricPeriods?: Partial<Record<"volume"|"cpc"|"adCompetition"|"adValue", {from:string;to:string}>>; evidenceIds:string[]}[]};
    competitors: {meta: SectionMeta; items: {source:"geo"; name:string; metric:string; value:number; evidenceId:string}[]|null};
    gtm: {meta: SectionMeta; strategy: ConsultingStrategy|null};
    keywords: {meta: SectionMeta; rows: Omit<StructuredMetrics["keywords"][number], "evidenceIds"|"currency">[]};
    methodology: {meta: SectionMeta; metricDefs: {key:string; definition:string; source:string; formula:string|null; version:string}[]; selectionLimits: (SectionMeta["selection"])[]};
}
export interface ConsultingSnapshot {
    schemaVersion?: "v2";
    structuredMetrics?: StructuredMetrics;
    sections?: ConsultingSectionsDTO;
    llmInput?: Omit<ConsultingSnapshot, "llmInput"|"sections"|"structuredMetrics"|"schemaVersion">;
    market: Market;
    range: {
        from: string;
        to: string;
    };
    evidence: EvidenceRef[];
    sourceStatus: ConsultingReportDTO["sourceStatus"];
    limitations: string[];
    selection: {
        source: string;
        total: number;
        selected: number;
        limit: number;
        rule: string;
    }[];
    monthlyMarketingBudget: {
        amount: number;
        currency: Currency;
    } | null;
}
export interface ConsultingStrategy {
    diagnosis: Diagnosis;
    channelMix: ChannelRecommendation[];
    budgetProposal: BudgetProposal;
    priorityActions: PriorityAction[];
}
