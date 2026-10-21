import type { Market } from "@/types/visibility"; // MARKETS 재사용

export type SeoEngine = "google" | "naver";
export type AuditScope = "technical" | "research" | "ranking" | "full";
export type AuditMode = "instant" | "crawl";
export type AuditStatus = "pending" | "completed" | "partial" | "failed";
export type CheckStatus =
  "pass" | "warning" | "fail" | "unknown" | "not_applicable";
export type RankStatus =
  | "ranked"
  | "not_found_in_range"
  | "no_result"
  | "unsupported"
  | "failed"
  | "pending";
export type RankSource = "serp" | "labs";

export interface SeoCheckResult {
  key: string; // 체크 식별자(§4.2 15개)
  label: string;
  status: CheckStatus;
  weight: number; // §4.2 가중치
  detail: string; // 판정 설명(사용자용)
  evaluatedSamples: number; // 평가 표본 수
  failedSamples: number;
  affectedUrls: string[]; // 최대 20개
  recommendation: string | null;
  subFindings?: { label: string; status: CheckStatus }[]; // 다중기준 하위 근거
}

export interface SeoAuditDTO {
  id: string;
  domainId: string;
  market: Market;
  scope: AuditScope;
  mode: AuditMode | null;
  status: AuditStatus;
  technicalScore: number | null; // null=비포함/판정부족
  scoreVersion: string; // 'v1'
  coverage: number | null; // 0~1. 0.7 미만이면 UI '참고 점수' 배지
  checks: SeoCheckResult[];
  costKrw: number; // 조회용 합계
  crawledPages: number | null; // 벤더 실제 처리 페이지
  requestedPages: number | null; // 사용자 요청 상한
  createdAt: string; // ISO8601 UTC
  completedAt: string | null;
  tasks: AuditTaskStatus[]; // 세부 작업 상태(민감필드 제외)
  failReason: string | null;
}

// SeoTask의 '공개 가능한' 상태만 (vendorTaskId·frozenInput 제외)
export interface AuditTaskStatus {
  failedUrls?: string[];
  operation: string;
  status: "pending" | "claimed" | "submitted" | "completed" | "partial" | "skipped" | "failed" | "uncertain";
  itemKey: string;
  failReason: string | null;
}

export interface SeoKeywordDTO {
  id: string;
  keyword: string;
  market: Market;
  engine: SeoEngine;
  searchVolume: number | null;
  volumeScale: string | null;
  volumePeriod: string | null;
  competition: number | null; // 광고 경쟁도(SEO 난이도 아님)
  competitionRaw: string | null;
  difficulty?: number | null;
  cpc?: number | null;
  adCompetition?: string | null;
  adValue?: number | null;
  rank: number | null; // 직접 SERP 최신 유효 캐시
  rankStatus: RankStatus | null;
  rankObservedAt: string | null;
  isOpportunity: boolean; // §5.2 기회 판정(볼륨 있음 + 11~30위 또는 범위 내 미발견)
  metricsUpdatedAt: string | null;
}

export interface SeoRankingDTO {
  id: string;
  keywordId: string;
  keyword: string;
  market: Market;
  engine: SeoEngine;
  device: string;
  rank: number | null;
  rankAbsolute: number | null;
  matchedUrl: string | null;
  status: RankStatus;
  source: RankSource;
  sourceObservedAt: string | null; // Labs 기준 시각
  returnedRange: number | null;
  capturedAt: string; // 수집 시각
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}
