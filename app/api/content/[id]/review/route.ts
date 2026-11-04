import { NextResponse } from 'next/server';
import { authenticated } from '@/lib/visibility/http';
import { contentIdSchema, contentReviewSchema } from '@/schemas/content';
import { reviewContentRecord } from '@/lib/content/review';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return authenticated(async ownerId => {
    const row = await reviewContentRecord(ownerId, contentIdSchema.parse((await context.params).id),
      contentReviewSchema.parse(await request.json()));
    return NextResponse.json({ data: { id: row.id, review_status: row.reviewStatus,
      reviewed_at: row.reviewedAt, updated_at: row.updatedAt, changed: row.changed }, error: null });
  }, request, { requireOrigin: true });
}
