import { NextResponse } from 'next/server';
import { authenticated, readJsonBody } from '@/lib/visibility/http';
import { contentIdSchema } from '@/schemas/content';
import { regenerateBodyImage } from '@/lib/content/regenerate-image';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return authenticated(async ownerId => {
    const id = contentIdSchema.parse((await context.params).id);
    return NextResponse.json({ data: await regenerateBodyImage(ownerId, id, await readJsonBody(request)) });
  }, request, { requireOrigin: true });
}
