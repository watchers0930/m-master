import { NextResponse } from 'next/server';
import { authenticated, queryParams } from '@/lib/visibility/http';
import { contentListSchema } from '@/schemas/content';
import { listContentRecords } from '@/lib/content/queries';
export async function GET(request: Request) {
  return authenticated(async ownerId => NextResponse.json({
    data: await listContentRecords(ownerId, contentListSchema.parse(queryParams(request))), error: null,
  }), request);
}
