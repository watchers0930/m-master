import { NextResponse } from 'next/server';
import { z } from 'zod';
import { entityId } from '@/schemas/id';
import { authenticated } from '@/lib/visibility/http';
import { publishContentNow } from '@/lib/publish/service';
const schema = z.object({ content_id: entityId,  }).strict();
export async function POST(request: Request) {
  return authenticated(async ownerId => {
    const input = schema.parse(await request.json());
    const data = await publishContentNow({ ownerId, contentId: input.content_id, channel: 'instagram', trigger: 'manual' }).then(r => ({ id: r.externalId, url: r.externalUrl }));
    return NextResponse.json({ data, error: null });
  }, request, { requireOrigin: true });
}
