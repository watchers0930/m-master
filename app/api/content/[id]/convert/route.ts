import { authenticated } from '@/lib/visibility/http';
import { contentIdSchema } from '@/schemas/content';
import { convertContent } from '@/lib/content/convert';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return authenticated(async ownerId => convertContent(ownerId,
    contentIdSchema.parse((await context.params).id), request), request, { requireOrigin: true });
}
