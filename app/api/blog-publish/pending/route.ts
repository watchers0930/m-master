import { NextResponse } from 'next/server';
import { jsonError, VisibilityError }  from '@/lib/visibility/http';
import { requireWorker } from '@/lib/publish/worker-auth';
import { pendingBlogContent } from '@/lib/publish/worker';

export async function GET(request: Request) {
  try {
    requireWorker(request);
    if (request.headers.get('x-blog-worker-protocol') !== 'claim-v1')
      throw new VisibilityError('worker_upgrade_required', 'claim-v1 작업자 프로토콜이 필요합니다.', 409);
    return NextResponse.json(await pendingBlogContent());
  } catch (error) { return jsonError(error); }
}
