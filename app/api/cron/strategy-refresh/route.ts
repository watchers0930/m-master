import { NextRequest } from 'next/server';
import { pipelineRequest } from '@/lib/pipeline/http';
import { refreshWeeklyStrategies } from '@/lib/pipeline/weekly-strategy';
export const maxDuration=300;
export const dynamic='force-dynamic';
export async function GET(request:NextRequest) {
  return pipelineRequest(request,'owner_id',refreshWeeklyStrategies);
}
