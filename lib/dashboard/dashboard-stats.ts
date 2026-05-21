// lib/dashboard/dashboard-stats.ts — 대시보드 Prisma 집계 함수

import { extractPath } from '@/lib/ab-test/url-utils';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { kstNow } from '@/lib/ga4/_internal';

// ---------------------------------------------------------------------------
// 타입
// ---------------------------------------------------------------------------

export interface AvgScorePair {
  thisAvg: number | null;
  lastAvg: number | null;
}

export interface RecentContentPath {
  contentId: string;
  path: string | null; // extractPath(schedule_slots.external_url). URL 없으면 null.
}

// ---------------------------------------------------------------------------
// 헬퍼: 월 시작/끝 Date 생성
// ---------------------------------------------------------------------------

function monthRange(monthStr: string): { gte: Date; lt: Date } {
  const [yearStr, mStr] = monthStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(mStr, 10);
  const gte = new Date(`${yearStr}-${mStr}-01T00:00:00.000Z`);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const lt = new Date(
    `${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00.000Z`,
  );
  return { gte, lt };
}

// ---------------------------------------------------------------------------
// 구현
// ---------------------------------------------------------------------------

/**
 * 이번달 vs 지난달 AI 평균 검수 점수 쌍을 반환.
 * @param monthStr 이번달 'YYYY-MM'
 * 빈 결과(콘텐츠 없음) -> { thisAvg: null, lastAvg: null }
 * DB 오류 -> 동일하게 null 반환 (throw 금지)
 */
export async function fetchAvgScorePair(
  monthStr: string,
): Promise<AvgScorePair> {
  try {
    // 지난달 계산 (1월 -> 작년 12월)
    const [yearStr, mStr] = monthStr.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(mStr, 10);
    const prevYear = month === 1 ? year - 1 : year;
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevMonthStr = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;

    const thisRange = monthRange(monthStr);
    const prevRange = monthRange(prevMonthStr);

    const [thisRows, prevRows] = await Promise.all([
      prisma.content.findMany({
        where: {
          scores: { not: Prisma.AnyNull },
          createdAt: { gte: thisRange.gte, lt: thisRange.lt },
        },
        select: { scores: true },
      }),
      prisma.content.findMany({
        where: {
          scores: { not: Prisma.AnyNull },
          createdAt: { gte: prevRange.gte, lt: prevRange.lt },
        },
        select: { scores: true },
      }),
    ]);

    const calcAvg = (rows: { scores: unknown }[]) => {
      if (rows.length === 0) return null;
      const valid = rows.filter(r => {
        const s = r.scores as { avg?: number } | null;
        return s?.avg != null;
      });
      if (valid.length === 0) return null;
      return Math.round(
        valid.reduce((sum, r) => {
          const s = r.scores as { avg?: number } | null;
          return sum + (s?.avg ?? 0);
        }, 0) / valid.length,
      );
    };

    return {
      thisAvg: calcAvg(thisRows),
      lastAvg: calcAvg(prevRows),
    };
  } catch (e) {
    console.error('[dashboard-stats] fetchAvgScorePair 실패:', e);
    return { thisAvg: null, lastAvg: null };
  }
}

/**
 * 지정 월에 발행(status='published')된 schedule_slots 수를 반환.
 * @param monthStr 'YYYY-MM'
 */
export async function fetchSchedulePublishedCount(
  monthStr: string,
): Promise<number> {
  try {
    const { gte, lt } = monthRange(monthStr);
    const count = await prisma.scheduleSlot.count({
      where: {
        status: 'published',
        scheduledAt: { gte, lt },
      },
    });
    return count;
  } catch (e) {
    console.error('[dashboard-stats] fetchSchedulePublishedCount 실패:', e);
    return 0;
  }
}

/**
 * 다음달 schedule_slots 수를 반환 (배너 표시 여부 판단용).
 * 0이면 배너 렌더 스킵.
 */
export async function fetchUpcomingMonthScheduleCount(): Promise<number> {
  try {
    const now = kstNow();
    const m = now.getMonth() + 1; // 1-12
    const nextM = m === 12 ? 1 : m + 1;
    const nextY = m === 12 ? now.getFullYear() + 1 : now.getFullYear();
    const nextMonthStr = `${nextY}-${String(nextM).padStart(2, '0')}`;

    const { gte, lt } = monthRange(nextMonthStr);
    const count = await prisma.scheduleSlot.count({
      where: {
        scheduledAt: { gte, lt },
      },
    });
    return count;
  } catch (e) {
    console.error(
      '[dashboard-stats] fetchUpcomingMonthScheduleCount 실패:',
      e,
    );
    return 0;
  }
}

/**
 * 최근 콘텐츠 ID 배열을 받아 각 ID에 대응하는 published schedule_slot의
 * external_url에서 pathname을 추출해 반환.
 * - path 추출 실패(URL 없음, 파싱 오류) -> null
 *
 * @param contentIds contents.id 배열
 * @returns { contentId, path }[] — 개수는 contentIds와 동일, 순서 보장
 */
export async function fetchRecentContentPaths(
  contentIds: string[],
): Promise<RecentContentPath[]> {
  if (contentIds.length === 0) return [];

  try {
    const slots = await prisma.scheduleSlot.findMany({
      where: {
        status: 'published',
        contentId: { in: contentIds },
      },
      select: { contentId: true, externalUrl: true },
    });

    // contentId -> externalUrl 매핑
    const urlMap = new Map<string, string>();
    for (const row of slots) {
      if (row.contentId && row.externalUrl) {
        // 동일 contentId에 슬롯 여러 개면 첫 번째만 사용
        if (!urlMap.has(row.contentId)) {
          urlMap.set(row.contentId, row.externalUrl);
        }
      }
    }

    // extractPath 안전 호출 (throw 허용 -> null 폴백)
    return contentIds.map(id => {
      const url = urlMap.get(id);
      if (!url) return { contentId: id, path: null };
      try {
        return { contentId: id, path: extractPath(url) };
      } catch {
        return { contentId: id, path: null };
      }
    });
  } catch (e) {
    console.error('[dashboard-stats] fetchRecentContentPaths 실패:', e);
    return contentIds.map(id => ({ contentId: id, path: null }));
  }
}
