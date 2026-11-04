import { NextResponse } from 'next/server';
import { authenticated, readJsonBody } from '@/lib/visibility/http';
import { contentIdSchema } from '@/schemas/content';
import { convertContent } from '@/lib/content/convert';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return authenticated(async ownerId => {
    const id = contentIdSchema.parse((await context.params).id);
    return NextResponse.json({ data: await convertContent(ownerId, id, await readJsonBody(request)), error: null });
  }, request, { requireOrigin: true });
}
