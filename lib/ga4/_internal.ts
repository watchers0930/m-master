import { BetaAnalyticsDataClient } from '@google-analytics/data';
import fs from 'fs';
import path from 'path';

let client: BetaAnalyticsDataClient | null = null;
let clientExp = 0;
const CLIENT_TTL = 5 * 60 * 1000;

// GA4 접근 실패 시 빠르게 skip 하기 위한 플래그
let ga4Disabled = false;
let ga4DisabledUntil = 0;
const GA4_DISABLE_TTL = 5 * 60 * 1000; // 5분간 비활성

type CacheEntry = { data: unknown; expiresAt: number };
const cache = new Map<string, CacheEntry>();

export const TTL = {
  REALTIME: 30 * 1000,
  OVERVIEW: 5 * 60 * 1000,
  DETAIL: 15 * 60 * 1000,
} as const;

export type Period = '7d' | '30d' | '90d' | '365d' | 'today' | 'yesterday' | 'this_week' | 'this_month';
export interface DimensionValue {
  value?: string | null;
}

export interface MetricValue {
  value?: string | null;
}

export interface ReportRow {
  dimensionValues?: DimensionValue[] | null;
  metricValues?: MetricValue[] | null;
}

function loadCredentials(): object | undefined {
  // 1) OAuth refresh token → authorized_user 형식 (우선)
  const clientId = process.env.GA4_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GA4_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GA4_OAUTH_REFRESH_TOKEN;
  if (clientId && clientSecret && refreshToken) {
    return {
      type: 'authorized_user',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    };
  }

  // 2) 서비스 계정 JSON (인라인 또는 파일) — fallback
  const value =
    process.env.GA4_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.GA4_KEY_FILE;
  if (value) {
    const trimmed = value.trim();
    if (trimmed.startsWith('{')) {
      try {
        return JSON.parse(trimmed);
      } catch {
        /* fall through */
      }
    } else {
      const resolved = path.resolve(trimmed);
      if (fs.existsSync(resolved)) {
        return JSON.parse(fs.readFileSync(resolved, 'utf-8'));
      }
    }
  }

  return undefined;
}

export function isGa4Available(): boolean {
  if (ga4Disabled && Date.now() < ga4DisabledUntil) return false;
  if (ga4Disabled) ga4Disabled = false; // TTL 만료 → 재시도
  const credentials = loadCredentials();
  if (!credentials) return false;
  const pid = process.env.GA4_PROPERTY_ID;
  return !!pid;
}

function disableGa4(reason: string) {
  ga4Disabled = true;
  ga4DisabledUntil = Date.now() + GA4_DISABLE_TTL;
  console.warn(`[ga4] Disabled for 5min: ${reason}`);
}

export function getClient(): BetaAnalyticsDataClient {
  if (client && Date.now() < clientExp) return client;
  const credentials = loadCredentials();
  if (!credentials) throw new Error('GA4 credentials are not configured.');

  // google-auth-library의 fromJSON은 authorized_user 타입에서
  // 반드시 client_id / client_secret 키를 요구한다.
  // credentials 객체가 올바른 형식인지 확인 후 전달.
  const cred = credentials as Record<string, unknown>;
  if (cred.type === 'authorized_user' && cred.client_id && cred.client_secret && cred.refresh_token) {
    // UserRefreshClient를 직접 생성하여 credentials 전달
    const { UserRefreshClient } = require('google-auth-library') as typeof import('google-auth-library');
    const authClient = new UserRefreshClient(
      cred.client_id as string,
      cred.client_secret as string,
      cred.refresh_token as string,
    );
    client = new BetaAnalyticsDataClient({ authClient, fallback: 'rest' });
  } else {
    client = new BetaAnalyticsDataClient({ credentials, fallback: 'rest' });
  }

  clientExp = Date.now() + CLIENT_TTL;
  return client;
}

export function getPropertyId(): string {
  const raw = process.env.GA4_PROPERTY_ID ?? '';
  return raw.startsWith('properties/') ? raw : `properties/${raw}`;
}

export function getCached<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.data as T;
}

export function setCache(key: string, data: unknown, ttl: number) {
  cache.set(key, { data, expiresAt: Date.now() + ttl });
}

export function kstNow(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

export function parseNum(v: string | null | undefined) {
  return parseFloat(v ?? '0') || 0;
}

export function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export { toYMD as ymd };

export function periodToDates(period: Period) {
  switch (period) {
    case 'today':
      return { startDate: 'today', endDate: 'today' };
    case 'yesterday':
      return { startDate: 'yesterday', endDate: 'yesterday' };
    case 'this_week': {
      const now = kstNow();
      const diff = now.getDay() === 0 ? 6 : now.getDay() - 1;
      const mon = new Date(now);
      mon.setDate(now.getDate() - diff);
      return { startDate: toYMD(mon), endDate: 'today' };
    }
    case 'this_month': {
      const now = kstNow();
      return { startDate: toYMD(new Date(now.getFullYear(), now.getMonth(), 1)), endDate: 'today' };
    }
    case '7d':
      return { startDate: '7daysAgo', endDate: 'today' };
    case '30d':
      return { startDate: '30daysAgo', endDate: 'today' };
    case '90d':
      return { startDate: '90daysAgo', endDate: 'today' };
    case '365d':
      return { startDate: '365daysAgo', endDate: 'today' };
  }
}

export function prevPeriodDates(period: Period) {
  switch (period) {
    case 'today':
      return { startDate: 'yesterday', endDate: 'yesterday' };
    case 'yesterday': {
      const now = kstNow();
      const twoDaysAgo = new Date(now);
      twoDaysAgo.setDate(now.getDate() - 2);
      return { startDate: toYMD(twoDaysAgo), endDate: toYMD(twoDaysAgo) };
    }
    case 'this_week': {
      const now = kstNow();
      const diff = now.getDay() === 0 ? 6 : now.getDay() - 1;
      const mon = new Date(now);
      mon.setDate(now.getDate() - diff);
      const prevMon = new Date(mon);
      prevMon.setDate(mon.getDate() - 7);
      const prevSun = new Date(prevMon);
      prevSun.setDate(prevMon.getDate() + 6);
      return { startDate: toYMD(prevMon), endDate: toYMD(prevSun) };
    }
    case 'this_month': {
      const now = kstNow();
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return { startDate: toYMD(first), endDate: toYMD(last) };
    }
    case '7d':
      return { startDate: '14daysAgo', endDate: '8daysAgo' };
    case '30d':
      return { startDate: '60daysAgo', endDate: '31daysAgo' };
    case '90d':
      return { startDate: '180daysAgo', endDate: '91daysAgo' };
    case '365d':
      return { startDate: '730daysAgo', endDate: '366daysAgo' };
  }
}

export function calcDelta(cur: number, prev: number): number {
  if (prev === 0) return cur > 0 ? 100 : 0;
  return ((cur - prev) / prev) * 100;
}

export async function safe<T>(fn: () => Promise<T>, label: string, fallback: T): Promise<T> {
  // GA4가 비활성 상태면 즉시 fallback 반환
  if (!isGa4Available()) return fallback;

  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`GA4 timeout: ${label}`)), 15_000),
    );
    const result = await Promise.race([fn(), timeout]);
    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[ga4] ${label} failed:`, msg);
    // 403/권한 에러 시 GA4 전체 비활성화 (429 rate limit은 일시적이므로 제외)
    if (msg.includes('PERMISSION_DENIED') || msg.includes('403')) {
      disableGa4(msg);
    }
    return fallback;
  }
}
