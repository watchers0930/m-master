import { NextResponse } from 'next/server';
import { authenticated, queryParams } from '@/lib/visibility/http';
import { ga4QuerySchema } from '@/schemas/ga4';
import { apiGa4Scope, scopedBlock } from '@/lib/ga4/api';
import { fetchDowChannelPattern } from '@/lib/ga4/popular';
export interface DowPattern { blog: number[]; instagram: number[]; facebook: number[] }
export interface ChannelTotals { blog: number; instagram: number; facebook: number }
export interface DowMatrix { blog: number[]; instagram: number[]; facebook: number[] }
export async function GET(request: Request) {
  return authenticated(async ownerId => {
    const input = ga4QuerySchema.parse(queryParams(request));
    return NextResponse.json({ data: await scopedBlock(await apiGa4Scope(ownerId, input.domain_id), fetchDowChannelPattern) });
  }, request);
}
