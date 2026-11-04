import { NextResponse } from 'next/server';
import { authenticated, queryParams } from '@/lib/visibility/http';
import { ga4QuerySchema } from '@/schemas/ga4';
import { apiGa4Scope, scopedBlock } from '@/lib/ga4/api';
import { fetchRealtime } from '@/lib/ga4/visitors';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return authenticated(async ownerId => {
    const input = ga4QuerySchema.parse(queryParams(request));
    const data = await scopedBlock(await apiGa4Scope(ownerId, input.domain_id), async scope => {
      const result = await fetchRealtime(scope);
      return result.status === 'success' ? { ...result, data: { active_users: result.data.activeUsers, timestamp: result.data.timestamp } } : result;
    });
    return NextResponse.json({ data });
  }, request);
}
