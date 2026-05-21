// lib/unsplash/search.ts — Unsplash 검색 (Demo 등급, 50req/hr)
// 본문 [이미지: 설명] 마커마다 1장씩 매칭
// UNSPLASH_ACCESS_KEY 미설정 시 getAccessKey()가 throw → 호출처에서 null로 폴백.

const UNSPLASH_API = 'https://api.unsplash.com';

interface UnsplashPhoto {
  id: string;
  urls: { regular: string; small: string };
  links: { download_location: string };
  alt_description: string | null;
}

interface SearchResponse {
  results: UnsplashPhoto[];
}

function getAccessKey(): string {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) throw new Error('UNSPLASH_ACCESS_KEY 환경변수 미설정');
  return key;
}

// 라이선스 준수: 사용한 사진의 download_location을 ping
async function trackDownload(downloadLocation: string): Promise<void> {
  try {
    await fetch(downloadLocation, {
      headers: { 'Authorization': `Client-ID ${getAccessKey()}` },
    });
  } catch (err) {
    console.warn('[unsplash] download tracking 실패 (무시):', err);
  }
}

// Unsplash URL에 비율(crop) 파라미터 적용 — 채널별 비율 강제
// 16:9 (블로그), 4:3 (블로그 대안), 1:1 (인스타 피드), 1.91:1 (페이스북)
export type AspectRatio = '16:9' | '4:3' | '1:1' | '1.91:1';

const RATIO_DIMS: Record<AspectRatio, { w: number; h: number }> = {
  '16:9':   { w: 1080, h: 608 },
  '4:3':    { w: 1080, h: 810 },
  '1:1':    { w: 1080, h: 1080 },
  '1.91:1': { w: 1080, h: 566 },
};

export function applyAspectRatio(url: string, ratio: AspectRatio = '16:9'): string {
  try {
    const u = new URL(url);
    const { w, h } = RATIO_DIMS[ratio];
    u.searchParams.set('w', String(w));
    u.searchParams.set('h', String(h));
    u.searchParams.set('fit', 'crop');
    u.searchParams.set('crop', 'entropy');
    u.searchParams.set('auto', 'format');
    u.searchParams.set('q', '80');
    return u.toString();
  } catch {
    return url;
  }
}

// 단일 쿼리 검색 — 첫 결과 URL 반환 (지정 비율로 crop)
// page 옵션으로 다른 결과 페이지에서 가져올 수 있음 (재생성 시 다양성 확보)
export async function searchOne(
  query: string,
  opts: { page?: number; aspectRatio?: AspectRatio } = {},
): Promise<string | null> {
  const key = getAccessKey();
  const page = opts.page ?? 1;
  const ratio = opts.aspectRatio ?? '16:9';
  // 1:1 정사각이면 orientation=squarish, 가로형이면 landscape
  const orientation = ratio === '1:1' ? 'squarish' : 'landscape';
  const url = `${UNSPLASH_API}/search/photos?query=${encodeURIComponent(query)}&per_page=1&page=${page}&orientation=${orientation}&content_filter=high`;

  const res = await fetch(url, {
    headers: { 'Authorization': `Client-ID ${key}`, 'Accept-Version': 'v1' },
  });

  if (!res.ok) {
    console.warn(`[unsplash] search 실패 (${res.status}):`, query);
    return null;
  }

  const data = (await res.json()) as SearchResponse;
  const photo = data.results[0];
  if (!photo) {
    console.warn(`[unsplash] 검색 결과 없음:`, query);
    return null;
  }

  // 라이선스 준수: 사용 시 download 트래킹 (fire-and-forget)
  trackDownload(photo.links.download_location);

  return applyAspectRatio(photo.urls.regular, ratio);
}

// 여러 쿼리 일괄 검색 — 결과 배열(null 포함 가능)
// 병렬 처리: Demo 등급 50req/hr 한도 안에서 글당 6~10회는 안전
export async function searchMany(
  queries: string[],
  opts: { aspectRatio?: AspectRatio } = {},
): Promise<(string | null)[]> {
  const settled = await Promise.allSettled(queries.map((q) => searchOne(q, opts)));
  return settled.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    console.warn(`[unsplash] 검색 예외:`, queries[i], r.reason);
    return null;
  });
}

// 본문에서 [이미지: 설명] 마커 추출 (순서 유지)
export function extractImagePrompts(text: string): string[] {
  const prompts: string[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\[이미지:\s*(.+?)\]\s*$/);
    if (m) prompts.push(m[1].trim());
  }
  return prompts;
}

// 폴백: 마커가 부족하면 H2 직후마다 자동 삽입
// H2 타이틀을 그대로 설명으로 사용 (Unsplash 매칭에 한국어 보편 키워드라 OK)
export function ensureMinimumMarkers(text: string, minMarkers: number = 5): string {
  const existing = extractImagePrompts(text);
  if (existing.length >= minMarkers) return text;

  const lines = text.split('\n');
  const result: string[] = [];
  let insertedCount = existing.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    result.push(line);

    // H2 라인 다음에 마커 삽입 (이미 마커가 있는 H2는 건너뜀)
    if (/^##\s+/.test(line) && insertedCount < minMarkers + 1) {
      const h2Title = line.replace(/^##\s+/, '').replace(/[#*]/g, '').trim();
      // 다음 비공백 라인까지 스캔: 이미 [이미지: ...] 마커가 있으면 건너뜀
      let hasMarkerAfter = false;
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const next = lines[j].trim();
        if (next.length === 0) continue;
        if (next.match(/^\[이미지:/)) { hasMarkerAfter = true; break; }
        break; // 첫 비공백 라인이 마커가 아니면 종료
      }
      if (!hasMarkerAfter) {
        result.push('');
        result.push(`[이미지: ${h2Title}]`);
        insertedCount++;
      }
    }
  }

  return result.join('\n');
}
