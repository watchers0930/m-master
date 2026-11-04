import { NextResponse } from 'next/server';
import { authenticated, queryParams } from '@/lib/visibility/http';
import { z } from 'zod';
import { abTestGa4 } from '@/lib/ab-test/ga4';
async function handle(request: Request, context: { params: Promise<{ id: string }> }) {
  return authenticated(async ownerId => {
    z.object({}).strict().parse(queryParams(request));
    if (request.method === 'POST') {
      const body = await request.text();
      z.object({}).strict().parse(body ? JSON.parse(body) : {});
    }
    const id = z.string().min(1).max(200).parse((await context.params).id);
    return NextResponse.json({ data: await abTestGa4(ownerId, id), error: null });
  }, request, { requireOrigin: true });
}
export const GET = handle;
export const POST = handle;
