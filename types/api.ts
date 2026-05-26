// types/api.ts — API Request/Response 타입 정의

import type {
  AbTest,
  AbTestGa4Snapshot,
  AbTestMeasureDays,
  AbTestPathMetrics,
  AbTestStatus,
  AbTestWinner,
  Channel,
  Content,
  ContentScores,
  ContentStatus,
  SlotStatus,
} from './db';

// ----------------------------------------------------------------
// 공통 응답 래퍼
// ----------------------------------------------------------------
export interface ApiSuccess<T> {
  data: T;
  error: null;
}

export interface ApiError {
  data: null;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// ----------------------------------------------------------------
// RAG - Upload (즉시 인덱싱 통합)
// ----------------------------------------------------------------
export interface RagUploadResponse {
  doc_id: string;
  chunks: number;
}

// ----------------------------------------------------------------
// RAG - Search
// ----------------------------------------------------------------
export interface RagSearchChunk {
  id: string;
  text: string;
  similarity: number;
}

export interface RagSearchResponse {
  chunks: RagSearchChunk[];
}

// ----------------------------------------------------------------
// Content - Generate
// ----------------------------------------------------------------
export interface ContentGenerateRequest {
  topic: string;
  channel: Channel;
  tone?: string;
  keywords?: string[];
  use_rag?: boolean; // deprecated — 인덱싱된 문서 있으면 자동 참조
}

export interface ContentGenerateResponse {
  id: string;
  text: string;
  image_url: string | null;
  body_image_urls: string[];
  scores: ContentScores;
  cost_krw: number;
  topic?: string;
}

// ----------------------------------------------------------------
// Schedule - Manual
// ----------------------------------------------------------------
export interface ScheduleManualRequest {
  content_id: string;
  channel: Channel;
  scheduled_at: string; // ISO 8601
}

export interface ScheduleManualResponse {
  slot_id: string;
}

// ----------------------------------------------------------------
// Schedule - Slot PATCH
// ----------------------------------------------------------------
export interface ScheduleSlotPatchRequest {
  scheduled_at?: string;
  status?: SlotStatus;
}

// ----------------------------------------------------------------
// Publish - Blog
// ----------------------------------------------------------------
export interface PublishBlogRequest {
  content_id: string;
}

export interface PublishBlogResponse {
  html: string;
  filename: string;
  download_url: string;
}

// ----------------------------------------------------------------
// Content List (관리)
// ----------------------------------------------------------------
export interface ContentListItem {
  id: string;
  channel: Channel;
  topic: string;
  status: ContentStatus;
  scores: ContentScores | null;
  cost_krw: number;
  created_at: string;
  updated_at: string;
}

export interface ContentListResponse {
  items: ContentListItem[];
  total: number;
  page: number;
  per_page: number;
}

// ----------------------------------------------------------------
// Settings
// ----------------------------------------------------------------
export interface SettingsPatchRequest {
  brand_guide?: Record<string, unknown>;
  prompt_templates?: Record<string, unknown>;
  budget_monthly?: number;
  alert_threshold?: number;
  notifications?: Record<string, boolean>;
}

// ----------------------------------------------------------------
// A/B Test
// ----------------------------------------------------------------
export interface AbTestCreateRequest {
  source_content_id: string;
  measure_days?: AbTestMeasureDays;
}

export interface AbTestVariantSummary {
  id: string;
  topic: string;
  text_body: string | null;
  image_url: string | null;
  scores: ContentScores | null;
  cost_krw: number;
}

export interface AbTestCreateResponse {
  id: string;
  variant_a: AbTestVariantSummary;
  variant_b: AbTestVariantSummary;
  status: AbTestStatus;
  cost_krw_total: number;
}

export interface AbTestListRow extends AbTest {
  variant_a_topic: string;
  variant_b_topic: string;
}

export interface AbTestListQuery {
  status?: AbTestStatus;
  channel?: Channel;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface AbTestListResponse {
  data: AbTestListRow[];
  total: number;
}

export interface AbTestDetail extends AbTest {
  variant_a: Content;
  variant_b: Content;
}

export type AbTestPatchAction = 'start' | 'complete' | 'confirm_winner' | 'cancel';

export interface AbTestPatch {
  variant_a_url?: string | null;
  variant_b_url?: string | null;
  measure_days?: AbTestMeasureDays;
  action?: AbTestPatchAction;
  winner?: AbTestWinner;
}

export interface AbTestGa4Response {
  variant_a: AbTestPathMetrics;
  variant_b: AbTestPathMetrics;
  period: { from: string; to: string };
  auto_completed?: boolean;
  snapshot?: AbTestGa4Snapshot | null;
}
