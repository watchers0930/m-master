// lib/api/analytics.ts — 성과 분석 API 래퍼 (mock 포함)
import type { ApiResponse } from '@/types/api';
import type { Channel } from '@/types/db';

export interface KPISummary {
  total_views: number;
  total_clicks: number;
  total_reach: number;
  avg_ctr: number;
  content_count: number;
  scheduled_count: number;
  cost_mtd: number; // 이번달 누적비용(원)
  budget_monthly: number;
}

export interface AnalyticsSeries {
  date: string;
  views: number;
  clicks: number;
}

export interface ChannelStats {
  channel: Channel;
  views: number;
  clicks: number;
}

export interface AnalyticsSummaryResponse {
  kpis: KPISummary;
  series: AnalyticsSeries[];
  by_channel: ChannelStats[];
}

// ── Mock ─────────────────────────────────────────────────────────

const MOCK_SERIES: AnalyticsSeries[] = Array.from({ length: 30 }, (_, i) => {
  const d = new Date('2026-04-07');
  d.setDate(d.getDate() + i);
  return {
    date: d.toISOString().slice(0, 10),
    views: Math.floor(Math.random() * 300) + 50,
    clicks: Math.floor(Math.random() * 40) + 5,
  };
});

// ── API 함수 ─────────────────────────────────────────────────────

export async function getAnalyticsSummary(params?: {
  from?: string;
  to?: string;
  channel?: Channel;
}): Promise<ApiResponse<AnalyticsSummaryResponse>> {
  // TODO: BE 연동
  void params;

  const kpis: KPISummary = {
    total_views: 8420,
    total_clicks: 634,
    total_reach: 5200,
    avg_ctr: 7.5,
    content_count: 12,
    scheduled_count: 3,
    cost_mtd: 15540,
    budget_monthly: 500000,
  };

  return {
    data: {
      kpis,
      series: MOCK_SERIES,
      by_channel: [
        { channel: 'blog', views: 8420, clicks: 634 },
        { channel: 'instagram', views: 0, clicks: 0 },
        { channel: 'facebook', views: 0, clicks: 0 },
      ],
    },
    error: null,
  };
}

export interface SettingsData {
  brand_guide: {
    tone?: string;
    forbidden_words?: string[];
    company_name?: string;
    industry?: string;
    core_keywords?: string[];
    services?: string[];
    target_audience?: string;
    cta_message?: string;
    website_url?: string;
  };
  prompt_templates: Record<string, string>;
  budget_monthly: number;
  alert_threshold: number;
  notifications: Record<string, boolean>;
  analytics_keys: { ga4_property_id?: string };
}

export async function getSettings(): Promise<ApiResponse<SettingsData>> {
  const [settingsRes, ga4Res] = await Promise.all([
    fetch('/api/settings', { cache: 'no-store' }).catch(() => null),
    fetch('/api/settings/ga4', { cache: 'no-store' }).catch(() => null),
  ]);

  const defaults: SettingsData = {
    brand_guide: {},
    prompt_templates: {},
    budget_monthly: 500000,
    alert_threshold: 0.8,
    notifications: {
      publish_success: true,
      low_score: true,
      ai_schedule_complete: true,
      performance_spike: false,
      budget_80pct: true,
    },
    analytics_keys: { ga4_property_id: '' },
  };

  if (settingsRes?.ok) {
    const j = await settingsRes.json();
    if (j.data) {
      defaults.brand_guide = j.data.brand_guide ?? {};
      defaults.prompt_templates = j.data.prompt_templates ?? {};
      defaults.budget_monthly = j.data.budget_monthly ?? 500000;
      defaults.alert_threshold = j.data.alert_threshold ?? 0.8;
      defaults.notifications = j.data.notifications ?? defaults.notifications;
    }
  }

  if (ga4Res?.ok) {
    const g = await ga4Res.json();
    defaults.analytics_keys = { ga4_property_id: g.ga4_property_id ?? '' };
  }

  return { data: defaults, error: null };
}

export async function updateSettings(updates: Record<string, unknown>): Promise<ApiResponse<null>> {
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    return { data: null, error: { code: 'save_failed', message: j.error ?? '설정 저장 실패' } };
  }
  return { data: null, error: null };
}
