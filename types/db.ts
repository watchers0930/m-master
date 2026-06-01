// types/db.ts — Supabase DB 테이블 타입 정의 (strict, 추측 금지)

export type SourceType = 'pdf' | 'md' | 'docx' | 'url' | 'manual';
export type DocumentStatus = 'uploaded' | 'indexed' | 'failed';
export type Channel = 'blog' | 'instagram' | 'facebook' | 'naver_cafe';
export type ContentStatus = 'draft' | 'scheduled' | 'published' | 'failed';
export type SlotStatus = 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled';
export type SlotMode = 'manual' | 'ai_auto';
export type CostKind = 'chat' | 'embedding' | 'image' | 'external';
export type AnalyticsSource = 'ga4' | 'naver' | 'instagram' | 'facebook';

// ----------------------------------------------------------------
// rag_documents
// ----------------------------------------------------------------
export interface RagDocument {
  id: string;
  owner_id: string;
  title: string;
  source_type: SourceType;
  storage_path: string | null;
  status: DocumentStatus;
  created_at: string;
}

export type RagDocumentInsert = Omit<RagDocument, 'id' | 'created_at'> & {
  id?: string;
};

// ----------------------------------------------------------------
// rag_chunks
// ----------------------------------------------------------------
export interface RagChunk {
  id: string;
  doc_id: string;
  chunk_index: number;
  content: string;
  embedding: number[] | null;
  tokens: number;
}

export type RagChunkInsert = Omit<RagChunk, 'id'> & { id?: string };

// similarity는 쿼리에서 계산되는 파생 필드
export interface RagChunkWithSimilarity extends RagChunk {
  similarity: number;
}

// ----------------------------------------------------------------
// contents
// ----------------------------------------------------------------
export interface ContentScores {
  seo: number;
  readability: number;
  brand: number;
  legal: number;
  avg: number;
  [key: string]: number; // Json 호환 인덱스 시그니처
}

export interface Content {
  id: string;
  owner_id: string;
  channel: Channel;
  topic: string;
  tone: string | null;
  keywords: string[] | null;
  text_body: string | null;
  image_url: string | null;
  body_image_urls: string[];
  scores: ContentScores | null;
  cost_krw: number;
  status: ContentStatus;
  created_at: string;
  updated_at: string;
}

export type ContentInsert = Omit<Content, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
};

// ----------------------------------------------------------------
// schedule_slots
// ----------------------------------------------------------------
export interface ScheduleSlot {
  id: string;
  content_id: string;
  channel: Channel;
  scheduled_at: string;
  published_at: string | null;
  status: SlotStatus;
  mode: SlotMode;
  external_id: string | null;
  external_url: string | null;
  retry_count: number;
  last_error: string | null;
  created_at: string;
}

export type ScheduleSlotInsert = Omit<ScheduleSlot, 'id' | 'created_at'> & {
  id?: string;
};

export type ScheduleSlotUpdate = Partial<
  Pick<ScheduleSlot, 'scheduled_at' | 'status' | 'published_at' | 'external_id' | 'external_url' | 'retry_count' | 'last_error'>
>;

// ----------------------------------------------------------------
// analytics_daily
// ----------------------------------------------------------------
export interface AnalyticsDaily {
  date: string;
  channel: Channel;
  content_id: string | null;
  views: number;
  clicks: number;
  reach: number;
  saves: number;
  ctr: number;
  source: AnalyticsSource;
}

// ----------------------------------------------------------------
// channel_credentials
// ----------------------------------------------------------------
export interface ChannelCredential {
  id: string;
  channel: 'naver_cafe' | 'instagram' | 'facebook';
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
  meta: Record<string, unknown> | null;
  updated_at: string;
}

// ----------------------------------------------------------------
// cost_ledger
// ----------------------------------------------------------------
export interface CostLedger {
  id: string;
  occurred_at: string;
  kind: CostKind;
  tokens_in: number;
  tokens_out: number;
  krw: number;
  content_id: string | null;
}

export type CostLedgerInsert = Omit<CostLedger, 'id' | 'occurred_at'> & {
  id?: string;
  occurred_at?: string;
};

// ----------------------------------------------------------------
// settings
// ----------------------------------------------------------------
export interface BrandGuide {
  tone?: string;
  forbidden_words?: string[];
  [key: string]: unknown;
}

export interface PromptTemplates {
  blog?: string;
  instagram?: string;
  facebook?: string;
  [key: string]: unknown;
}

export interface NotificationSettings {
  publish_success?: boolean;
  low_score?: boolean;
  ai_schedule_complete?: boolean;
  performance_spike?: boolean;
  budget_80pct?: boolean;
  [key: string]: unknown;
}

export interface Settings {
  id: 1;
  brand_guide: BrandGuide;
  prompt_templates: PromptTemplates;
  budget_monthly: number;
  alert_threshold: number;
  notifications: NotificationSettings;
}

// ----------------------------------------------------------------
// audit_log
// ----------------------------------------------------------------
export interface AuditLog {
  id: string;
  actor: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

// Json 호환 payload 타입 (supabase Json 타입과 호환)
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type AuditLogInsert = {
  id?: string;
  actor: string | null;
  action: string;
  target_type?: string | null;
  target_id?: string | null;
  payload?: JsonValue | null;
};

// ----------------------------------------------------------------
// topic_recommendations
// ----------------------------------------------------------------
export interface TopicRecommendation {
  id: string;
  month: string | null;
  week_start: string | null;
  topic: string;
  score: number;
  factors: Record<string, unknown> | null;
  channel: Channel;
  created_at: string;
}

// ----------------------------------------------------------------
// ab_tests (A/B 테스트)
// ----------------------------------------------------------------
export type AbTestStatus = 'draft' | 'running' | 'completed' | 'cancelled';
export type AbTestWinner = 'a' | 'b' | 'tie';
export type AbTestWinnerDecidedBy = 'auto' | 'manual';
export type AbTestMeasureDays = 7 | 14 | 30;

export interface AbTestPathMetrics {
  sessions: number;
  screenPageViews: number;
  averageSessionDuration: number;
  bounceRate: number;
  engagementRate: number;
  [key: string]: number; // Json 호환 인덱스 시그니처
}

export interface AbTestGa4Snapshot {
  variant_a: AbTestPathMetrics;
  variant_b: AbTestPathMetrics;
  period: { from: string; to: string };
  captured_at: string;
  // Json 호환 (supabase update 시 Json 타입 매칭)
  [key: string]: AbTestPathMetrics | { from: string; to: string } | string;
}

export interface AbTest {
  id: string;
  owner_id: string;
  topic: string;
  channel: Channel;
  tone: string | null;
  keywords: string[] | null;
  variant_a_id: string;
  variant_b_id: string;
  status: AbTestStatus;
  winner: AbTestWinner | null;
  winner_decided_by: AbTestWinnerDecidedBy | null;
  measure_days: AbTestMeasureDays;
  variant_a_url: string | null;
  variant_b_url: string | null;
  variant_a_path: string | null;
  variant_b_path: string | null;
  started_at: string | null;
  completed_at: string | null;
  ga4_snapshot: AbTestGa4Snapshot | null;
  created_at: string;
  updated_at: string;
}

export type AbTestInsert = Omit<
  AbTest,
  'id' | 'created_at' | 'updated_at' | 'started_at' | 'completed_at' |
  'winner' | 'winner_decided_by' | 'variant_a_url' | 'variant_b_url' |
  'variant_a_path' | 'variant_b_path' | 'ga4_snapshot'
> & {
  id?: string;
  started_at?: string | null;
  completed_at?: string | null;
  winner?: AbTestWinner | null;
  winner_decided_by?: AbTestWinnerDecidedBy | null;
  variant_a_url?: string | null;
  variant_b_url?: string | null;
  variant_a_path?: string | null;
  variant_b_path?: string | null;
  ga4_snapshot?: AbTestGa4Snapshot | null;
};

export type AbTestUpdate = Partial<
  Pick<AbTest,
    'status' | 'winner' | 'winner_decided_by' | 'measure_days' |
    'variant_a_url' | 'variant_b_url' | 'variant_a_path' | 'variant_b_path' |
    'started_at' | 'completed_at' | 'ga4_snapshot'
  >
>;
