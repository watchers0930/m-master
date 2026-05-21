// ─────────────────────────────────────────────
// Domain types (DB 스키마 기반)
// ─────────────────────────────────────────────

export type Channel = 'blog' | 'instagram' | 'facebook';

export type ContentStatus = 'draft' | 'scheduled' | 'published' | 'failed';

export type SlotStatus =
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'cancelled';

export type RagDocStatus = 'uploaded' | 'indexed' | 'failed';

export type SourceType = 'pdf' | 'md' | 'docx' | 'url' | 'manual';

export interface AIScores {
  seo: number;
  readability: number;
  brand: number;
  legal: number;
  avg: number;
}

export interface Content {
  id: string;
  owner_id: string;
  channel: Channel;
  topic: string;
  tone?: string;
  keywords: string[];
  text_body: string;
  image_url?: string;
  scores?: AIScores;
  cost_krw: number;
  status: ContentStatus;
  created_at: string;
  updated_at: string;
}

export interface ScheduleSlot {
  id: string;
  content_id: string;
  channel: Channel;
  scheduled_at: string;
  published_at?: string;
  status: SlotStatus;
  mode: 'manual' | 'ai_auto';
  external_id?: string;
  external_url?: string;
  retry_count: number;
  last_error?: string;
}

export interface RagDocument {
  id: string;
  owner_id: string;
  title: string;
  source_type: SourceType;
  storage_path?: string;
  status: RagDocStatus;
  created_at: string;
}

export interface RagChunk {
  id: string;
  doc_id: string;
  chunk_index: number;
  content: string;
  tokens: number;
  similarity?: number;
}

export interface AnalyticsDaily {
  date: string;
  channel: Channel;
  content_id?: string;
  views: number;
  clicks: number;
  reach: number;
  saves: number;
  ctr: number;
  source: 'ga4' | 'naver' | 'instagram' | 'facebook';
}

export interface KPISummary {
  total_views: number;
  total_clicks: number;
  total_reach: number;
  avg_ctr: number;
  content_count: number;
  scheduled_count: number;
}

export interface ChannelCredential {
  id: string;
  channel: Channel;
  expires_at?: string;
  meta?: Record<string, unknown>;
}

export interface BrandGuide {
  tone_keywords: string[];
  forbidden_words: string[];
  company_name: string;
  tagline?: string;
}

export interface Settings {
  brand_guide: BrandGuide;
  prompt_templates: Record<string, string>;
  budget_monthly: number;
  alert_threshold: number;
  notifications: {
    publish_success: boolean;
    low_score: boolean;
    ai_schedule_done: boolean;
    performance_spike: boolean;
    budget_80pct: boolean;
  };
}
