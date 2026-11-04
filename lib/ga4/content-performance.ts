import { prisma } from '@/lib/prisma';
import { extractPath, InvalidUrlError } from '@/lib/ab-test/url-utils';
import { fetchMultiplePathMetrics, fetchMultiplePathSessionsByNaver, type PathMetrics } from '@/lib/ga4/visitors';
import { scopedBlock } from '@/lib/ga4/api';
import type { ScopeResult } from '@/lib/ga4/scope';
import type { Channel } from '@/types/db';
export interface ContentPerformanceRow {
  content_id: string;
  title: string;
  channel: Channel;
  published_at: string | null;
  external_url: string | null;
  page_path: string | null;
  metrics: PathMetrics | null;
  naver_sessions: number | null;
}

export interface ContentPerformanceResponse {
  data: ContentPerformanceRow[];
  period: { from: string; to: string; days: number };
  ga4_fallback: boolean;
  error: string | null;
}

export async function contentPerformance(ownerId: string, days: number, scope: ScopeResult) {
  const now = new Date(), from = new Date(Date.now() - days * 86400000);
  const period = { from: from.toISOString().slice(0,10), to: now.toISOString().slice(0,10), days };
    // content 테이블 기준으로 published 콘텐츠 조회 + schedule_slots JOIN
    const contents = await prisma.content.findMany({
      where: {
        ownerId,
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
      orderBy: { createdAt: 'desc' }, take: 100,
    });

    const rows: Array<Omit<ContentPerformanceRow, 'metrics' | 'naver_sessions'>> = [];
    for (const content of contents) {
      const slot = content.scheduleSlots[0];
      const externalUrl = slot?.externalUrl ?? null;
      let pagePath: string | null = null;

      if (externalUrl) {
        try {
          pagePath = scope.ok && new URL(externalUrl).hostname.toLowerCase() === scope.scope.host ? extractPath(externalUrl) : null;
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


  const paths = [...new Set(rows.map(r => r.page_path).filter((p): p is string => !!p))];
  const [ga4, naver] = await Promise.all([
    scopedBlock(scope, s => fetchMultiplePathMetrics(paths, from, now, s)),
    scopedBlock(scope, s => fetchMultiplePathSessionsByNaver(paths, from, now, s)),
  ]);
  return { data: rows.map(row => ({ ...row,
    metrics: row.page_path && ga4.state === 'ok' ? ga4.data[row.page_path] ?? null : null,
    naver_sessions: row.page_path && naver.state === 'ok' ? naver.data[row.page_path] ?? null : null,
  })), period, ga4, naver, ga4_fallback: ga4.state !== 'ok', error: null };
}
