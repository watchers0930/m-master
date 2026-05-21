// lib/ab-test/url-utils.ts — URL → pathname 추출 유틸
// GA4 page path 매핑용. 호스트/쿼리/해시 제거.

export class InvalidUrlError extends Error {
  constructor(message = '유효하지 않은 URL입니다') {
    super(message);
    this.name = 'InvalidUrlError';
  }
}

/**
 * URL 문자열에서 pathname만 추출.
 * - 절대 URL (https://...) 만 허용. 상대경로 입력은 InvalidUrlError.
 * - 쿼리스트링/해시 제거
 * - pathname이 빈 문자열이면 '/' 반환
 */
export function extractPath(url: string): string {
  if (typeof url !== 'string' || url.trim().length === 0) {
    throw new InvalidUrlError('URL이 비어 있습니다');
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new InvalidUrlError('URL 파싱 실패');
  }

  if (!parsed.protocol || !['http:', 'https:'].includes(parsed.protocol)) {
    throw new InvalidUrlError('http(s) URL만 허용됩니다');
  }

  const path = parsed.pathname || '/';
  return path;
}
