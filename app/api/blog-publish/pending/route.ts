import { NextResponse } from 'next/server';
import { jsonError } from '@/lib/visibility/http';
import { requireWorker } from '@/lib/publish/worker-auth';
import { pendingBlogContent } from '@/lib/publish/worker';

export async function GET(request: Request) {
  try {
    // x-api-key + claim-v1 + x-blog-worker-owner(허용 목록) + 비상 정지 스위치
    const { ownerId } = requireWorker(request, { automation: true });
    return NextResponse.json(await pendingBlogContent(ownerId));
  } catch (error) { return jsonError(error); }
}
