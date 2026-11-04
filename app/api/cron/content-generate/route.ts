import { NextRequest } from 'next/server';
import { pipelineRequest } from '@/lib/pipeline/http';
import { generateDailyContent } from '@/lib/pipeline/content-generate';
export const maxDuration=300;
export const dynamic='force-dynamic';
export async function GET(request:NextRequest) {
  return pipelineRequest(request,null,() => generateDailyContent());
}
