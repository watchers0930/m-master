export const MARKETS = ["ko-KR", "en-US", "en-GB", "en-CA", "en-AU"] as const;
export type Market = (typeof MARKETS)[number];
export const DEFAULT_MARKET: Market = "ko-KR";
export type EngineId = "chatgpt" | "ai_overviews" | "perplexity" | "gemini";
export type Frequency = "daily" | "weekly";
export type SnapshotStatus = "ok" | "no_result" | "failed" | "pending";
export type Subject = "brand" | "competitor" | "domain";
export type Sentiment = "positive" | "neutral" | "negative";

export interface VisibilityQueryDTO {
  id: string;
  domainId: string | null;
  query: string;
  market: Market;
  engines: EngineId[];
  brandAliases: string[];
  competitorAliases: string[];
  frequency: Frequency;
  active: boolean;
  createdAt: string; // ISO8601 (UTC)
  lastCapturedAt: string | null;
}

export interface DomainDTO {
  id: string;
  url: string; // 정규화 호스트
  market: Market;
  businessType: string | null;
  createdAt: string;
}

// 집계 응답 (GET /api/visibility/data)
export interface EngineScore {
  engine: EngineId;
  validSamples: number; // 브랜드 언급 판정의 유효 표본 수
  citationValidSamples: number; // 도메인 인용 판정의 독립 분모
  mentionedCount: number;
  citedCount: number;
  sov: number | null; // mentionedCount / validSamples (null = 표본 0)
  citationRate: number | null;
  unresolvableCount: number; // 판정 불가 (분모 제외)
  failedCount: number; // 실패·미지원·결과없음 (분모 제외)
  lastCapturedAt: string | null;
}
export interface TrendPoint {
  date: string;
  sov: number | null;
  citationRate: number | null;
  validSamples: number;
  citationValidSamples: number;
}
export interface CompetitorScore {
  label: string;
  mentionedCount: number;
  mentionRate: number | null;
  cited: boolean;
}
export interface CitationItem {
  url: string;
  title: string | null;
  position: number;
  isOwnDomain: boolean;
  engine: EngineId;
  capturedAt: string;
}

export interface VisibilityDataResponse {
  engines: EngineScore[];
  trend: TrendPoint[];
  competitors: CompetitorScore[];
  citations: CitationItem[];
  nextCitationCursor?: string | null;
  totalValidSamples: number;
  filters: {
    market: Market;
    from: string;
    to: string;
    queryId: string | null;
    domainId: string | null;
  };
}

// 엔진 어댑터 공통 결과 (lib/visibility/engines/types.ts)
export interface EngineResult {
  engine: EngineId;
  status: SnapshotStatus;
  source: string; // llm_scraper | llm_responses | serp_aio | passthrough
  answerText: string;
  citations: Citation[];
  raw: unknown;
  costKrw: number;
  taskId?: string;
  failReason?: string;
}
export interface Citation {
  url: string;
  title?: string;
  position: number;
}
