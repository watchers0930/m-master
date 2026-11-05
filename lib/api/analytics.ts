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
}

// 일반 설정만 읽는다. GA4 연결 상태는 useGa4Settings(React Query 단일 쿼리)가 단독 소유 —
// 여기서 /api/settings/ga4 를 다시 부르면 설정 진입마다 중복 요청이 생긴다(설계 §4.6, 성능 원칙).
export async function getSettings(): Promise<ApiResponse<SettingsData>> {
  const settingsRes = await fetch('/api/settings', { cache: 'no-store' }).catch(() => null);

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
  };

  // 조회 실패를 기본값으로 감추지 않는다 — 기본값 폼을 저장하면 실제 설정(브랜드 가이드 등)을 덮어쓴다
  if (!settingsRes?.ok) {
    return { data: null, error: { code: 'load_failed', message: settingsRes ? `설정을 불러오지 못했습니다 (HTTP ${settingsRes.status})` : '네트워크 오류로 설정을 불러오지 못했습니다' } };
  }
  {
    const j = await settingsRes.json().catch(() => null);
    if (!j) return { data: null, error: { code: 'load_failed', message: '설정 응답을 읽지 못했습니다' } };
    if (j.data) {
      defaults.brand_guide = j.data.brand_guide ?? {};
      defaults.prompt_templates = j.data.prompt_templates ?? {};
      defaults.budget_monthly = j.data.budget_monthly ?? 500000;
      defaults.alert_threshold = j.data.alert_threshold ?? 0.8;
      defaults.notifications = j.data.notifications ?? defaults.notifications;
    }
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
    const e = j?.error;
    const message = typeof e === 'string' ? e : typeof e?.message === 'string' ? e.message : '설정 저장 실패';
    return { data: null, error: { code: 'save_failed', message } };
  }
  return { data: null, error: null };
}
