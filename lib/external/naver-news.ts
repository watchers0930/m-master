// lib/external/naver-news.ts — 네이버 뉴스 검색 API (서버 전용)

interface NaverNewsItem {
  title: string;
  description: string;
  pubDate: string;
  link: string;
}

interface NaverNewsResponse {
  items: NaverNewsItem[];
}

export interface NewsResult {
  title: string;
  summary: string;
  date: string;
}

// 간단한 인메모리 캐시 (3분 TTL)
const cache = new Map<string, { data: NewsResult[]; expires: number }>();
const CACHE_TTL = 3 * 60 * 1000;

/** HTML 태그 + 네이버 강조 태그 제거 */
function stripHtml(text: string): string {
  return text
    .replace(/<\/?b>/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'")
    .trim();
}

/** 날짜 포맷 (Thu, 30 May 2026 → 2026.05.30) */
function formatDate(pubDate: string): string {
  try {
    const d = new Date(pubDate);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}.${m}.${day}`;
  } catch {
    return '';
  }
}

/**
 * 네이버 뉴스 검색 API 호출
 * @param query - 검색 키워드
 * @param count - 결과 수 (기본 5)
 * @returns 뉴스 결과 배열 (실패 시 빈 배열)
 */
export async function searchNaverNews(
  query: string,
  count: number = 5,
): Promise<NewsResult[]> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.warn('[naver-news] NAVER_CLIENT_ID/SECRET 미설정');
    return [];
  }

  // 캐시 확인
  const cacheKey = `news:${query}:${count}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.data;

  try {
    const params = new URLSearchParams({
      query,
      display: String(count),
      sort: 'date',
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(
      `https://openapi.naver.com/v1/search/news.json?${params}`,
      {
        headers: {
          'X-Naver-Client-Id': clientId,
          'X-Naver-Client-Secret': clientSecret,
        },
        signal: controller.signal,
      },
    );
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[naver-news] API 응답 ${res.status}`);
      return [];
    }

    const data = (await res.json()) as NaverNewsResponse;
    const results: NewsResult[] = (data.items ?? []).map((item) => ({
      title: stripHtml(item.title),
      summary: stripHtml(item.description),
      date: formatDate(item.pubDate),
    }));

    // 캐시 저장
    cache.set(cacheKey, { data: results, expires: Date.now() + CACHE_TTL });

    return results;
  } catch (err) {
    console.warn('[naver-news] 검색 실패:', err);
    return [];
  }
}
