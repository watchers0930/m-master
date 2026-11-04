import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticated } from '@/lib/visibility/http';
import { publishContentNow } from '@/lib/publish/service';
const schema = z.object({ content_id: z.string().min(1).max(200),  }).strict();
export async function POST(request: Request) {
  return authenticated(async ownerId => {
    const input = schema.parse(await request.json());
    const data = await publishContentNow({ ownerId, contentId: input.content_id, channel: 'facebook', trigger: 'manual' }).then(r => ({ id: r.externalId, url: r.externalUrl }));
    return NextResponse.json({ data, error: null });
  }, request, { requireOrigin: true });
}
