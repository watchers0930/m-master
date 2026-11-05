// 요청 출처(CSRF) 판정 단일 구현 — middleware.ts(전 /api 변이 공통)와 lib/visibility/http.ts authenticated() 가 공유.
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

/** 교차 사이트 변이 여부: sec-fetch-site=cross-site 이거나 Origin 이 요청 URL 출처와 다르면 true. */
export function isCrossSiteMutation(req: Request): boolean {
  if (SAFE_METHODS.includes(req.method)) return false;
  const origin = req.headers.get('origin');
  return req.headers.get('sec-fetch-site') === 'cross-site' || (!!origin && origin !== new URL(req.url).origin);
}

/** requireOrigin 엄격 모드: 동일 Origin 명시(또는 Origin 없이 same-origin fetch)만 허용. */
export function hasSameOriginProof(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (req.headers.get('sec-fetch-site') === 'cross-site') return false;
  return origin === new URL(req.url).origin || (!origin && req.headers.get('sec-fetch-site') === 'same-origin');
}
