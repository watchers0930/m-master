import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { VisibilityError } from '@/lib/visibility/errors';
import { assertAutomationEnabled } from '@/lib/pipeline/automation';
export function secureEqual(value: string | null, expected: string | undefined) {
  if (!value || !expected) return false;
  return timingSafeEqual(createHash('sha256').update(value).digest(), createHash('sha256').update(expected).digest());
}
export function workerOwners(): string[] {
  return [...new Set((process.env.BLOG_PUBLISH_OWNER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean))].slice(0, 100);
}
export const WORKER_PROTOCOL = 'claim-v1';
const ownerHeaderSchema = z.string().trim().min(1).max(200);
/**
 * 작업자 인증(x-api-key ↔ env BLOG_PUBLISH_API_KEY) + claim-v1 프로토콜 헤더 + 소유자 헤더 확인. 4개 작업자 라우트 공용.
 *  - 작업자 1개 배포 = 소유자 1명(네이버 세션 1개). x-blog-worker-owner가 BLOG_PUBLISH_OWNER_IDS에 있어야 하고,
 *    반환된 ownerId로만 claim을 발급·검증·기록한다(다른 소유자 글이 이 계정에 게시되지 않도록).
 *  - automation: true(pending·verify)는 비상 정지 스위치를 따른다. complete·fail은 이미 일어난 게시의
 *    기록·반납이므로 정지 중에도 받아야 한다(막으면 실제 게시가 기록되지 않아 중복 게시 위험).
 */
export function requireWorker(request: Request, opts: { automation?: boolean } = {}): { ownerId: string } {
  if (!secureEqual(request.headers.get('x-api-key'), process.env.BLOG_PUBLISH_API_KEY)) {
    throw new VisibilityError('unauthorized', '인증이 필요합니다.', 401);
  }
  if (request.headers.get('x-blog-worker-protocol') !== WORKER_PROTOCOL)
    throw new VisibilityError('worker_upgrade_required', 'claim-v1 작업자 프로토콜이 필요합니다.', 409);
  const owner = ownerHeaderSchema.safeParse(request.headers.get('x-blog-worker-owner') ?? '');
  if (!owner.success) throw new VisibilityError('worker_owner_required', '작업자 소유자 지정이 필요합니다.', 400);
  if (!workerOwners().includes(owner.data)) throw new VisibilityError('owner_not_allowed', '허용되지 않은 소유자입니다.', 403);
  if (opts.automation) assertAutomationEnabled();
  return { ownerId: owner.data };
}
