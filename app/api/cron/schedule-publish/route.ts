import { NextRequest } from 'next/server';
import { pipelineRequest } from '@/lib/pipeline/http';
import { publishScheduledContent } from '@/lib/pipeline/schedule-publish';
export const maxDuration=300;
export const dynamic='force-dynamic';
export async function GET(request:NextRequest) {
  return pipelineRequest(request,null,() => publishScheduledContent());
}
