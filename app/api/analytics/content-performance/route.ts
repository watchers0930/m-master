import { NextResponse } from 'next/server';
import { authenticated, queryParams } from '@/lib/visibility/http';
import { performanceQuerySchema } from '@/schemas/ga4';
import { apiGa4Scope } from '@/lib/ga4/api';
import { contentPerformance } from '@/lib/ga4/content-performance';
export type { ContentPerformanceRow, ContentPerformanceResponse } from '@/lib/ga4/content-performance';
export async function GET(request: Request) {
  return authenticated(async ownerId => {
    const input = performanceQuerySchema.parse(queryParams(request));
    return NextResponse.json(await contentPerformance(ownerId, input.days, await apiGa4Scope(ownerId, input.domain_id)));
  }, request);
}
