import { NextResponse } from 'next/server';
import { jsonError } from '@/lib/visibility/http';
import { requireWorker } from '@/lib/publish/worker-auth';
import { completeWorkerClaim } from '@/lib/publish/worker';
import { workerCompleteSchema } from '@/schemas/blog-worker';

export async function POST(request: Request) {
  try {
    requireWorker(request);
    const input = workerCompleteSchema.parse(await request.json());
    return NextResponse.json(await completeWorkerClaim(input.contentId, input.claimToken, input.externalUrl));
  } catch (error) { return jsonError(error); }
}
