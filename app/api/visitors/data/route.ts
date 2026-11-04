import { NextResponse } from 'next/server';
import { authenticated, queryParams } from '@/lib/visibility/http';
import { visitorsQuerySchema } from '@/schemas/ga4';
import { apiGa4Scope } from '@/lib/ga4/api';
import { visitorData } from '@/lib/ga4/visitor-data';
export async function GET(request: Request) {
  return authenticated(async ownerId => {
    const input = visitorsQuerySchema.parse(queryParams(request));
    return NextResponse.json({ data: await visitorData(input.period, await apiGa4Scope(ownerId, input.domain_id)), error: null });
  }, request);
}
