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

export async function getSettings(): Promise<
  ApiResponse<{
    brand_guide: { tone?: string; forbidden_words?: string[] };
    prompt_templates: Record<string, string>;
    budget_monthly: number;
    alert_threshold: number;
    notifications: Record<string, boolean>;
    analytics_keys: { ga4_property_id?: string; ga4_service_account?: string };
  }>
> {
  // TODO: BE 연동 (현재 BE 미구현 — env 우선)
  let analytics_keys = { ga4_property_id: '', ga4_service_account: '' };
  try {
    const res = await fetch('/api/settings/ga4', { cache: 'no-store' });
    if (res.ok) {
      const j = await res.json();
      analytics_keys = {
        ga4_property_id: j.ga4_property_id ?? '',
        ga4_service_account: j.ga4_service_account ?? '',
      };
    }
  } catch {
    /* fetch 실패 시 빈 값 유지 */
  }

  return {
    data: {
      brand_guide: {
        tone: '전문적이고 신뢰감 있는',
        forbidden_words: ['싸다', '최저가', '무료'],
      },
      prompt_templates: {
        blog: 'VESTRA 부동산 AI 전문가 관점에서 {topic}에 대해 {tone} 톤으로 블로그 포스트를 작성하세요.',
      },
      budget_monthly: 500000,
      alert_threshold: 0.8,
      notifications: {
        publish_success: true,
        low_score: true,
        ai_schedule_complete: true,
        performance_spike: false,
        budget_80pct: true,
      },
      analytics_keys,
    },
    error: null,
  };
}

export async function updateSettings(updates: Record<string, unknown>): Promise<ApiResponse<null>> {
  // TODO: BE 연동
  void updates;
  await new Promise((r) => setTimeout(r, 500));
  return { data: null, error: null };
}
