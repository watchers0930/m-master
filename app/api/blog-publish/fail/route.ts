import { NextResponse } from 'next/server';
import { jsonError } from '@/lib/visibility/http';
import { requireWorker } from '@/lib/publish/worker-auth';
import { failWorkerClaim } from '@/lib/publish/worker';
import { workerFailSchema } from '@/schemas/blog-worker';

export async function POST(request: Request) {
  try {
    requireWorker(request);
    const input = workerFailSchema.parse(await request.json());
    return NextResponse.json(await failWorkerClaim(input.contentId, input.claimToken, input.outcome));
  } catch (error) { return jsonError(error); }
}
