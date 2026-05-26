// GET /api/analytics/ga4-pattern
// GA4 90일 데이터 → 채널별 최적 요일 + 세션 비율 반환
// { data: DowPattern, channel_totals: ChannelTotals, ga4_fallback: boolean }

import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { fetchDowChannelPattern } from '@/lib/ga4/visitors';

// GA4 sessionDefaultChannelGroup → 우리 채널 매핑
// 블로그: 검색/직접/레퍼럴/유료검색 유입 → 블로그 콘텐츠 발행 효과
// 인스타: Organic Social (인스타·네이버블로그 등 소셜)
// 페북: Paid Social / Cross-network (유료 소셜)
const CHANNEL_MAP: Record<string, 'blog' | 'instagram' | 'facebook'> = {
  'Organic Search':  'blog',
  'Direct':          'blog',
  'Paid Search':     'blog',
  'Referral':        'blog',
  'Organic Social':  'instagram',
  'Paid Social':     'facebook',
  'Cross-network':   'facebook',
};

export interface DowPattern {
  blog:      number[]; // 최적 요일 목록 (0=일 … 6=토), 세션 상위 3일
  instagram: number[];
  facebook:  number[];
}

export interface ChannelTotals {
  blog:      number; // 90일 누적 세션 수
  instagram: number;
  facebook:  number;
}

// 요일별 세션 raw matrix — 히트맵 시각화용 (analytics 페이지)
export interface DowMatrix {
  blog:      number[]; // 길이 7, index 0=일 … 6=토
  instagram: number[];
  facebook:  number[];
}

export async function GET() {
  await requireSession();
  try {
    const rows = await fetchDowChannelPattern();
    if (rows === null) {
      return NextResponse.json({
        data: { blog: [], instagram: [], facebook: [] },
        channel_totals: null,
        dow_matrix: { blog: Array(7).fill(0), instagram: Array(7).fill(0), facebook: Array(7).fill(0) },
        ga4_fallback: true,
        error: 'ga4_unavailable',
      });
    }

    // 채널별 요일 세션 합산
    const totals: Record<'blog' | 'instagram' | 'facebook', number[]> = {
      blog:      Array(7).fill(0),
      instagram: Array(7).fill(0),
      facebook:  Array(7).fill(0),
    };

    for (const row of rows) {
      const ch = CHANNEL_MAP[row.channel];
      if (ch) totals[ch][row.dow] += row.sessions;
    }

    // 채널별 상위 요일 추출
    // - 세션이 있는 요일 중 상위 5개
    // - 세션이 없는 채널은 빈 배열 반환 (폴백 없음)
    const topDows = (arr: number[]): number[] => {
      return arr
        .map((v, i) => ({ dow: i, v }))
        .filter(x => x.v > 0)
        .sort((a, b) => b.v - a.v)
        .slice(0, 5)
        .map(x => x.dow)
        .sort((a, b) => a - b);
    };

    const pattern: DowPattern = {
      blog:      topDows(totals.blog),
      instagram: topDows(totals.instagram),
      facebook:  topDows(totals.facebook),
    };

    // 채널별 90일 누적 세션 합계 → 슬롯 배분 비율에 사용
    const channel_totals: ChannelTotals = {
      blog:      totals.blog.reduce((a, b) => a + b, 0),
      instagram: totals.instagram.reduce((a, b) => a + b, 0),
      facebook:  totals.facebook.reduce((a, b) => a + b, 0),
    };

    // 요일별 raw matrix — 히트맵용 (totals를 그대로 노출, 7개 길이 보장)
    const dow_matrix: DowMatrix = {
      blog:      totals.blog,
      instagram: totals.instagram,
      facebook:  totals.facebook,
    };

    return NextResponse.json({ data: pattern, channel_totals, dow_matrix, ga4_fallback: false, error: null });
  } catch (err) {
    console.error('[ga4-pattern] GA4 조회 실패:', err instanceof Error ? err.message : err);
    return NextResponse.json({
      data: { blog: [], instagram: [], facebook: [] },
      channel_totals: null,
      dow_matrix: { blog: Array(7).fill(0), instagram: Array(7).fill(0), facebook: Array(7).fill(0) },
      ga4_fallback: true,
      error: 'ga4_unavailable',
    });
  }
}
