// lib/external/context-builder.ts — 외부 데이터 컨텍스트 조립 (서버 전용)

import { searchNaverNews } from './naver-news';
import { fetchRecentPriceSummary } from './molit';

/**
 * 토픽·키워드 기반으로 외부 데이터(뉴스 + 시세)를 병렬 수집하여 프롬프트용 텍스트 반환
 *
 * - 뉴스: 항상 조회 (토픽 관련 최신 뉴스 5건)
 * - MOLIT 시세: 부동산 토픽일 때만 조회
 * - 전부 실패해도 빈 문자열 반환 (기존 흐름 영향 없음)
 */
export async function buildExternalContext(
  topic: string,
  keywords: string[] = [],
): Promise<string> {
  const newsQuery = [topic, ...keywords.slice(0, 2)].join(' ');

  // 뉴스 + MOLIT 병렬 호출
  const [newsResults, molitSummary] = await Promise.allSettled([
    searchNaverNews(newsQuery, 5),
    fetchRecentPriceSummary(topic, keywords),
  ]);

  const sections: string[] = [];

  // 뉴스 섹션
  if (newsResults.status === 'fulfilled' && newsResults.value.length > 0) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const newsLines = newsResults.value.map(
      (n, i) => `${i + 1}. "${n.title}" (${n.date})\n   ${n.summary}`,
    );
    sections.push(
      `[최신 뉴스 — ${year}년 ${month}월 기준]\n${newsLines.join('\n')}`,
    );
  }

  // MOLIT 시세 섹션
  if (molitSummary.status === 'fulfilled' && molitSummary.value) {
    sections.push(molitSummary.value);
  }

  return sections.join('\n\n');
}
