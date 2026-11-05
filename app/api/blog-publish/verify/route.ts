import { NextResponse } from 'next/server';
import { jsonError } from '@/lib/visibility/http';
import { requireWorker } from '@/lib/publish/worker-auth';
import { verifyWorkerClaim } from '@/lib/publish/worker';
import { workerClaimSchema } from '@/schemas/blog-worker';

export async function POST(request: Request) {
  try {
    // 게시 직전 확인도 비상 정지 스위치를 따른다(정지 시 503 → 작업자는 게시하지 않음)
    const { ownerId } = requireWorker(request, { automation: true });
    const input = workerClaimSchema.parse(await request.json());
    return NextResponse.json(await verifyWorkerClaim(ownerId, input.contentId, input.claimToken));
  } catch (error) { return jsonError(error); }
}
