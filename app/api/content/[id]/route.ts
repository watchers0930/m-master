import { NextResponse } from 'next/server';
import { authenticated } from '@/lib/visibility/http';
import { contentIdSchema, contentEditSchema } from '@/schemas/content';
import { getContentRecord } from '@/lib/content/queries';
import { editContentRecord } from '@/lib/content/review';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return authenticated(async ownerId => NextResponse.json({ data: await getContentRecord(ownerId,
    contentIdSchema.parse((await context.params).id)), error: null }), request);
}
export async function PATCH(request: Request, context: Context) {
  return authenticated(async ownerId => {
    const id = contentIdSchema.parse((await context.params).id);
    await editContentRecord(ownerId, id, contentEditSchema.parse(await request.json()));
    return NextResponse.json({ data: await getContentRecord(ownerId, id), error: null });
  }, request, { requireOrigin: true });
}
