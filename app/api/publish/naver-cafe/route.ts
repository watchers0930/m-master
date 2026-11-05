import { NextResponse } from 'next/server';
import { z } from 'zod';
import { entityId } from '@/schemas/id';
import { authenticated } from '@/lib/visibility/http';
import { publishCafeTargets } from '@/lib/publish/manual';
const schema = z.object({ content_id: entityId, cafe_target_ids: z.array(entityId).max(20).optional(), }).strict();
export async function POST(request: Request) {
  return authenticated(async ownerId => {
    const input = schema.parse(await request.json());
    const data = await publishCafeTargets(ownerId, input.content_id, input.cafe_target_ids);
    return NextResponse.json({ data, error: 'results' in data && data.results?.some(r=>r.error) ? { code:'partial_failure',message:'일부 카페 발행 실패' } : null });
  }, request, { requireOrigin: true });
}
