import { NextResponse } from 'next/server';
import { jsonError } from '@/lib/visibility/http';
import { requireWorker } from '@/lib/publish/worker-auth';
import { pendingBlogContent } from '@/lib/publish/worker';

export async function GET(request: Request) {
  try {
    requireWorker(request); // x-api-key + x-blog-worker-protocol: claim-v1
    return NextResponse.json(await pendingBlogContent());
  } catch (error) { return jsonError(error); }
}
