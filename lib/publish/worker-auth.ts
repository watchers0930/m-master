import { createHash, timingSafeEqual } from 'node:crypto';
import { VisibilityError } from '@/lib/visibility/errors';
export function secureEqual(value: string | null, expected: string | undefined) {
  if (!value || !expected) return false;
  return timingSafeEqual(createHash('sha256').update(value).digest(), createHash('sha256').update(expected).digest());
}
export function workerOwners(): string[] {
  return [...new Set((process.env.BLOG_PUBLISH_OWNER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean))].slice(0, 100);
}
export function requireWorker(request: Request) {
  if (!secureEqual(request.headers.get('x-api-key'), process.env.BLOG_PUBLISH_API_KEY)) {
    throw new VisibilityError('unauthorized', '인증이 필요합니다.', 401);
  }
}
