import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { extractPath, InvalidUrlError } from '@/lib/ab-test/url-utils';
import {
  fetchMultiplePathMetrics,
  fetchMultiplePathSessionsByNaver,
  type PathMetrics,
} from '@/lib/ga4/visitors';
import type { Channel } from '@/types/db';

export interface ContentPerformanceRow {
  content_id: string;
  title: string;
  channel: Channel;
  published_at: string | null;
  external_url: string | null;
  page_path: string | null;
  metrics: PathMetrics;
  naver_sessions: number;
}

export interface ContentPerformanceResponse {
  data: ContentPerformanceRow[];
  period: { from: string; to: string; days: number };
  ga4_fallback: boolean;
  error: string | null;
}

const EMPTY_METRICS: PathMetrics = {
  sessions: 0,
  screenPageViews: 0,
  averageSessionDuration: 0,
  bounceRate: 0,
  engagementRate: 0,
};

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function GET(request: NextRequest) {
  await requireSession();
  const url = new URL(request.url);
  const daysRaw = parseInt(url.searchParams.get('days') ?? '30', 10);
  const days = Math.max(1, Math.min(Number.isFinite(daysRaw) ? daysRaw : 30, 90));
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - days);
  const period = { from: ymd(from), to: ymd(now), days };

  try {
    // content 테이블 기준으로 published 콘텐츠 조회 + schedule_slots JOIN
    const contents = await prisma.content.findMany({
      where: {
        status: 'published',
        createdAt: { gte: new Date(`${period.from}T00:00:00Z`) },
      },
      select: {
        id: true,
        topic: true,
        channel: true,
        createdAt: true,
        scheduleSlots: {
          where: { status: 'published', externalUrl: { not: null } },
          select: { publishedAt: true, externalUrl: true, targetName: true },
          orderBy: { publishedAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const rows: Array<Omit<ContentPerformanceRow, 'metrics' | 'naver_sessions'>> = [];
    for (const content of contents) {
      const slot = content.scheduleSlots[0];
      const externalUrl = slot?.externalUrl ?? null;
      let pagePath: string | null = null;

      if (externalUrl) {
        try {
          pagePath = extractPath(externalUrl);
        } catch (error) {
          if (!(error instanceof InvalidUrlError)) throw error;
        }
      }

      rows.push({
        content_id: content.id,
        title: content.topic ?? '(untitled)',
        channel: content.channel as Channel,
        published_at: slot?.publishedAt?.toISOString() ?? content.createdAt.toISOString(),
        external_url: externalUrl,
        page_path: pagePath,
      });
    }

    // GA4 조회는 page_path가 있는 항목만
    const pathRows = rows.filter((r) => r.page_path);
    const uniquePaths = Array.from(new Set(pathRows.map((r) => r.page_path!)));
    let ga4Fallback = false;
    let ga4Error: string | null = null;
    let metricsByPath: Record<string, PathMetrics> = {};
    let naverByPath: Record<string, number> = {};

    if (uniquePaths.length > 0) {
      const [metricsResult, naverResult] = await Promise.all([
        fetchMultiplePathMetrics(uniquePaths, from, now),
        fetchMultiplePathSessionsByNaver(uniquePaths, from, now),
      ]);

      if (metricsResult === null || naverResult === null) {
        ga4Fallback = true;
        ga4Error = 'GA4 unavailable';
        metricsByPath = Object.fromEntries(uniquePaths.map((p) => [p, { ...EMPTY_METRICS }]));
        naverByPath = Object.fromEntries(uniquePaths.map((p) => [p, 0]));
      } else {
        metricsByPath = metricsResult;
        naverByPath = naverResult;
      }
    }

    const data: ContentPerformanceRow[] = rows.map((row) => ({
      ...row,
      metrics: row.page_path ? (metricsByPath[row.page_path] ?? { ...EMPTY_METRICS }) : { ...EMPTY_METRICS },
      naver_sessions: row.page_path ? (naverByPath[row.page_path] ?? 0) : 0,
    }));

    data.sort((a, b) => b.metrics.sessions - a.metrics.sessions);

    return NextResponse.json<ContentPerformanceResponse>({
      data,
      period,
      ga4_fallback: ga4Fallback,
      error: ga4Error,
    });
  } catch (error) {
    console.error('[content-performance] error:', error);
    return NextResponse.json<ContentPerformanceResponse>({
      data: [],
      period,
      ga4_fallback: false,
      error: 'db_error',
    });
  }
}
