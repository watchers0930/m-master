import { NextRequest } from 'next/server';
import { pipelineRequest } from '@/lib/pipeline/http';
import { refreshWeeklyPlans } from '@/lib/pipeline/weekly-plan';
export const maxDuration=300;
export const dynamic='force-dynamic';
export async function GET(request:NextRequest) {
  return pipelineRequest(request,'ownerId',refreshWeeklyPlans);
}
