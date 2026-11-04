import { NextResponse } from 'next/server';
import { jsonError } from '@/lib/visibility/http';
import { requireWorker } from '@/lib/publish/worker-auth';
import { verifyWorkerClaim } from '@/lib/publish/worker';
import { workerClaimSchema } from '@/schemas/blog-worker';

export async function POST(request: Request) {
  try {
    requireWorker(request);
    const input = workerClaimSchema.parse(await request.json());
    return NextResponse.json(await verifyWorkerClaim(input.contentId, input.claimToken));
  } catch (error) { return jsonError(error); }
}
