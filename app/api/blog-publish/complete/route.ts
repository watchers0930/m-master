import { NextResponse } from 'next/server';
import { jsonError } from '@/lib/visibility/http';
import { requireWorker } from '@/lib/publish/worker-auth';
import { completeWorkerClaim } from '@/lib/publish/worker';
import { workerCompleteSchema } from '@/schemas/blog-worker';

export async function POST(request: Request) {
  try {
    // 정지 스위치와 무관하게 받는다: 이미 일어난 게시를 기록하지 못하면 중복 게시로 이어진다
    const { ownerId } = requireWorker(request);
    const input = workerCompleteSchema.parse(await request.json());
    return NextResponse.json(await completeWorkerClaim(ownerId, input.contentId, input.claimToken, input.externalUrl));
  } catch (error) { return jsonError(error); }
}
