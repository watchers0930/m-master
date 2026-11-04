import { createHash, timingSafeEqual } from 'node:crypto';
import { VisibilityError } from '@/lib/visibility/errors';
export function secureEqual(value: string | null, expected: string | undefined) {
  if (!value || !expected) return false;
  return timingSafeEqual(createHash('sha256').update(value).digest(), createHash('sha256').update(expected).digest());
}
export function workerOwners(): string[] {
  return [...new Set((process.env.BLOG_PUBLISH_OWNER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean))].slice(0, 100);
}
export const WORKER_PROTOCOL = 'claim-v1';
/** 작업자 인증(x-api-key ↔ env BLOG_PUBLISH_API_KEY) + claim-v1 프로토콜 헤더 확인. 4개 작업자 라우트 공용. */
export function requireWorker(request: Request) {
  if (!secureEqual(request.headers.get('x-api-key'), process.env.BLOG_PUBLISH_API_KEY)) {
    throw new VisibilityError('unauthorized', '인증이 필요합니다.', 401);
  }
  if (request.headers.get('x-blog-worker-protocol') !== WORKER_PROTOCOL)
    throw new VisibilityError('worker_upgrade_required', 'claim-v1 작업자 프로토콜이 필요합니다.', 409);
}
